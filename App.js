/**************************************************
 * GOOGLE SHEET (DYNAMIC — FROM LINK YOUR DATA)
 **************************************************/
let MASTER_SHEET_URL = localStorage.getItem("MASTER_SHEET_URL");
let GOOGLE_SHEET_CSV = localStorage.getItem("GOOGLE_SHEET_CSV");
let APP_STAGE = localStorage.getItem("APP_STAGE") || "LINK";

/**************************************************
 * CONFIG
 **************************************************/
const IMAGE_DURATION = 5;
const IMAGES_BEFORE_TABLE = 5;
const ROWS_PER_PAGE = 10;
const ROW_HIGHLIGHT_DURATION = 1;

/**************************************************
 * STATE
 **************************************************/
let slides = [];
let slideIndex = 0;
let slideTimer = null;
let paused = false;

let tablePages = [];
let tablePageIndex = 0;
let rowIndex = 0;
let rowTimer = null;

let imageMap = {}; // { A001: blobURL }

/* BID FLICKER */
let bidFlickerTimer = null;
let bidFlickerState = false;

/**************************************************
 * INDEXEDDB — IMAGE STORAGE
 **************************************************/
const DB_NAME = "auction_images_db";
const STORE = "images";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject();
  });
}

async function saveImages(files) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);

  files.forEach(f => {
    const key = f.name.split(".")[0];
    store.put(f, key);
  });

  localStorage.setItem("IMAGES_UPLOADED", "1");
}

async function loadImages() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const map = {};

  return new Promise(resolve => {
    store.openCursor().onsuccess = e => {
      const c = e.target.result;
      if (c) {
        map[c.key] = URL.createObjectURL(c.value);
        c.continue();
      } else resolve(map);
    };
  });
}

/**************************************************
 * DOM
 **************************************************/
const startScreen = document.getElementById("startScreen");
const app = document.getElementById("app");
const stage = document.querySelector(".stage");
const counter = document.getElementById("counter");

const uploadImagesBtn = document.getElementById("uploadImagesBtn");
const linkDataBtn = document.getElementById("linkDataBtn");
const startAuctionBtn = document.getElementById("startAuctionBtn");

const backBtn = document.getElementById("backBtn");
const refreshBtn = document.getElementById("refreshBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const sheetModal = document.getElementById("sheetModal");
const sheetLinkInput = document.getElementById("sheetLinkInput");
const confirmSheetBtn = document.getElementById("confirmSheetBtn");
const cancelSheetBtn = document.getElementById("cancelSheetBtn");
const setupStage = document.querySelector(".setupStage");
const actionStage = document.querySelector(".actionStage");

/**************************************************
 * IMAGE PICKER
 **************************************************/
const picker = document.createElement("input");
picker.type = "file";
picker.webkitdirectory = true;
picker.multiple = true;
picker.style.display = "none";
document.body.appendChild(picker);

function showSetupStage() {
  setupStage.style.display = "flex";
  actionStage.style.display = "none";
}

function showActionStage() {
  setupStage.style.display = "none";
  actionStage.style.display = "flex";
}

/**************************************************
 * INIT UI (STEP A FIX)
 **************************************************/
async function initUI() {
  startScreen.style.display = "block";
  app.style.display = "none";

  imageMap = await loadImages();

  const hasImages = Object.keys(imageMap).length > 0;
  const hasSheet = Boolean(GOOGLE_SHEET_CSV);

  linkDataBtn.disabled = !hasImages;
  startAuctionBtn.disabled = !(hasImages && hasSheet);

  if (hasImages && hasSheet) {
  showActionStage();
} else {
  showSetupStage();
}
  if (APP_STAGE === "RUNNING") {
    startScreen.style.display = "none";
    app.style.display = "grid";
    loadData();
  }
}

initUI();

/**************************************************
 * STEP 1 — UPLOAD IMAGES
 **************************************************/
uploadImagesBtn.onclick = () => picker.click();

picker.onchange = async () => {
  await saveImages([...picker.files]);
  imageMap = await loadImages();
  linkDataBtn.disabled = false;
  alert(`Images uploaded: ${Object.keys(imageMap).length}`);
};

/**************************************************
 * STEP 2 — LINK SHEET
 **************************************************/
linkDataBtn.onclick = () => {
  sheetLinkInput.value = MASTER_SHEET_URL || "";
  sheetModal.style.display = "flex";
};

cancelSheetBtn.onclick = () => {
  sheetModal.style.display = "none";
};

confirmSheetBtn.onclick = () => {
  const url = sheetLinkInput.value.trim();
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) {
    alert("Invalid Google Sheet link");
    return;
  }

  MASTER_SHEET_URL = url;
  GOOGLE_SHEET_CSV =
    `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;

  localStorage.setItem("MASTER_SHEET_URL", MASTER_SHEET_URL);
  localStorage.setItem("GOOGLE_SHEET_CSV", GOOGLE_SHEET_CSV);

  sheetModal.style.display = "none";
  startAuctionBtn.disabled = false;
  showActionStage();
  document.body.classList.add("sheet-linked");
};

/**************************************************
 * STEP 3 — START AUCTION
 **************************************************/
startAuctionBtn.onclick = () => {
  APP_STAGE = "RUNNING";
  localStorage.setItem("APP_STAGE", "RUNNING");
  initUI();
};

backBtn.onclick = () => {
  stopAllTimers();
  stopBidFlicker();
  paused = false;

  // 🔁 Reset app stage
  APP_STAGE = "LINK";
  localStorage.setItem("APP_STAGE", "LINK");

  // ✅ CRITICAL: reset UI state
  document.body.classList.remove("sheet-linked");

  // Optional but correct UX
  startAuctionBtn.disabled = true;

  initUI();
};

refreshBtn.onclick = loadData;



/**************************************************
 * LOAD DATA
 **************************************************/
async function loadData() {
  stopAllTimers();
  stopBidFlicker();

  const res = await fetch(GOOGLE_SHEET_CSV, { cache: "no-store" });
  const rows = parseCSV(await res.text()).filter(
    r => String(r.Status).toLowerCase() === "open"
  );

  slides = buildSlides(rows);
  slideIndex = 0;
  paused = false;

  pauseBtn.style.display = "inline-block";
  resumeBtn.style.display = "none";

  playSlide();
}

/**************************************************
 * SLIDES
 **************************************************/
function buildSlides(rows) {
  const out = [];
  let count = 0;

  for (const r of rows) {
    out.push({
      type: "item",
      record: r,
      image: imageMap[r.Item] || null
    });
    count++;

    if (count % IMAGES_BEFORE_TABLE === 0) {
      out.push({ type: "table", rows });
    }
  }
  return out;
}

/**************************************************
 * PLAYER
 **************************************************/
function playSlide() {
  stopAllTimers();
  stopBidFlicker();
  if (paused) return;

  const slide = slides[slideIndex];
  stage.classList.toggle("table-mode", slide.type === "table");

  if (slide.type === "item") {
    renderItem(slide);
    startBidFlicker();
    counter.textContent = `IMAGE ${slideIndex + 1}/${slides.length}`;
    slideTimer = setTimeout(nextSlide, IMAGE_DURATION * 1000);
  } else {
    playTable(slide.rows);
  }
}

/**************************************************
 * TABLE
 **************************************************/
function playTable(rows) {
  tablePages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    tablePages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  tablePageIndex = 0;
  playTablePage();
}

function playTablePage() {
  rowIndex = 0;
  drawTablePage();
  highlightRow();

  rowTimer = setInterval(() => {
    rowIndex++;
    if (rowIndex >= (tablePages[tablePageIndex] || []).length) {
      clearInterval(rowTimer);
      tablePageIndex++;
      if (tablePageIndex >= tablePages.length) {
        nextSlide();
        return;
      }
      playTablePage();
    }
    highlightRow();
  }, ROW_HIGHLIGHT_DURATION * 1000);
}

/**************************************************
 * NAVIGATION
 **************************************************/
function nextSlide() {
  slideIndex = (slideIndex + 1) % slides.length;
  playSlide();
}

function prevSlide() {
  slideIndex = (slideIndex - 1 + slides.length) % slides.length;
  playSlide();
}

prevBtn.onclick = prevSlide;
nextBtn.onclick = nextSlide;

/**************************************************
 * CONTROLS
 **************************************************/
pauseBtn.onclick = () => {
  paused = true;
  stopAllTimers();
  stopBidFlicker();
  pauseBtn.style.display = "none";
  resumeBtn.style.display = "inline-block";
};

resumeBtn.onclick = () => {
  paused = false;
  pauseBtn.style.display = "inline-block";
  resumeBtn.style.display = "none";
  playSlide();
};

/**************************************************
 * BID FLICKER
 **************************************************/
function startBidFlicker() {
  const bidEl = document.querySelector(".currentBid");
  if (!bidEl) return;

  bidFlickerState = false;
  bidEl.style.color = "#22c55e";

  bidFlickerTimer = setInterval(() => {
    bidFlickerState = !bidFlickerState;
    bidEl.style.color = bidFlickerState ? "#facc15" : "#22c55e";
  }, 600);
}

function stopBidFlicker() {
  clearInterval(bidFlickerTimer);
  bidFlickerTimer = null;
}

/**************************************************
 * HELPERS
 **************************************************/
function stopAllTimers() {
  clearTimeout(slideTimer);
  clearInterval(rowTimer);
}

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  const headers = lines.shift().split(",");
  return lines.map(l => {
    const v = l.split(",");
    const o = {};
    headers.forEach((h, i) => (o[h.trim()] = v[i]?.trim() || ""));
    return o;
  });
}

function renderItem(slide) {
  stage.innerHTML = `
    <div class="imageWrapper">
      ${slide.image ? `<img src="${slide.image}">` : `<div class="noImage">Image not found</div>`}
    </div>
    <div class="infoPanel">
      ${Object.entries(slide.record).map(([k,v]) => `
        <div class="block">
          <div class="label">${k}</div>
          <div class="value ${k.toLowerCase()==="current bid"?"currentBid":""}">
            ${v || "-"}
          </div>
        </div>`).join("")}
    </div>`;
}

function drawTablePage() {
  stage.innerHTML = `
    <div class="tableContainer">
      ${tableHTML(tablePages[tablePageIndex])}
    </div>`;
}

function tableHTML(rows) {
  const headers = ["Item", "Type", "Base Price", "Current Bid", "Name of Bidder", "Status"];

  return `
    <table class="auctionTable">
      <thead>
        <tr>
          ${headers.map(h => `<th>${h}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            r => `
          <tr>
            <td>${r.Item || ""}</td>
            <td>${r.Type || ""}</td>
            <td>${r["Base Price"] || ""}</td>
            <td>${r["Current Bid"] || ""}</td>
            <td>${r["Name of Bidder"] || ""}</td>
            <td>${r.Status || ""}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}
function highlightRow() {
  const rows = document.querySelectorAll(".auctionTable tbody tr");
  rows.forEach(r => r.classList.remove("active"));
  if (rows[rowIndex]) rows[rowIndex].classList.add("active");
}

function hardResetApp() {
  localStorage.clear();
  indexedDB.deleteDatabase("auction_images_db");
  location.reload();
}













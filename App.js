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
const app = document.getElementById("app");
const stage = document.querySelector(".stage");
const counter = document.getElementById("counter");

const linkButtons = document.getElementById("linkButtons");
const actionButtons = document.getElementById("actionButtons");

const linkDataBtn = document.getElementById("linkDataBtn");
const openSheetBtn = document.getElementById("openSheetBtn");
const startAuctionBtn = document.getElementById("startAuctionBtn");

const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const refreshBtn = document.getElementById("refreshBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const warningModal = document.getElementById("warningModal");
const warningOkBtn = document.getElementById("warningOkBtn");
const linkConfirmBtn = document.getElementById("linkConfirmBtn");
const sheetLinkInput = document.getElementById("sheetLinkInput");

/**************************************************
 * IMAGE PICKER (FOLDER)
 **************************************************/
const picker = document.createElement("input");
picker.type = "file";
picker.webkitdirectory = true;
picker.multiple = true;
picker.style.display = "none";
document.body.appendChild(picker);

const uploadBtn = document.createElement("button");
uploadBtn.textContent = "🖼 Upload Images";
uploadBtn.className = "btn secondary";
uploadBtn.style.marginRight = "12px";

/**************************************************
 * BACK BUTTON
 **************************************************/
const backBtn = document.createElement("button");
backBtn.textContent = "⬅ Back";
backBtn.className = "btn secondary";
backBtn.style.marginRight = "12px";

/**************************************************
 * INIT UI
 **************************************************/
async function initUI() {
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";

  backBtn.remove();
  uploadBtn.remove();

  imageMap = await loadImages();

  if (APP_STAGE === "LINK") {
    linkButtons.style.display = "flex";
    linkButtons.prepend(uploadBtn);
  }

  if (APP_STAGE === "READY" && MASTER_SHEET_URL && GOOGLE_SHEET_CSV) {
    actionButtons.style.display = "flex";
    actionButtons.prepend(backBtn);
  }

  if (APP_STAGE === "RUNNING" && GOOGLE_SHEET_CSV) {
    app.style.display = "grid";
    document.querySelector(".topControls").prepend(backBtn);
    loadData();
  }
}

initUI();

/**************************************************
 * IMAGE UPLOAD
 **************************************************/
uploadBtn.onclick = () => picker.click();

picker.onchange = async () => {
  await saveImages([...picker.files]);
  imageMap = await loadImages();
  alert(`Images loaded: ${Object.keys(imageMap).length}`);
};

/**************************************************
 * BACK ACTION
 **************************************************/
backBtn.onclick = () => {
  stopAllTimers();
  stopBidFlicker();
  paused = false;
  APP_STAGE = "LINK";
  localStorage.setItem("APP_STAGE", "LINK");
  initUI();
};

/**************************************************
 * MODAL
 **************************************************/
warningOkBtn.onclick = () => {
  warningModal.style.display = "none";
};

/**************************************************
 * LINK DATA
 **************************************************/
linkDataBtn.onclick = () => {
  sheetLinkInput.value = MASTER_SHEET_URL || "";
  warningModal.style.display = "flex";
};

linkConfirmBtn.onclick = async () => {
  const url = sheetLinkInput.value.trim();
  if (!url.includes("docs.google.com/spreadsheets")) {
    alert("Invalid Google Sheet link");
    return;
  }

  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) {
    alert("Invalid Google Sheet link");
    return;
  }

  MASTER_SHEET_URL = url;
  GOOGLE_SHEET_CSV =
    `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;

  APP_STAGE = "READY";

  localStorage.setItem("MASTER_SHEET_URL", url);
  localStorage.setItem("GOOGLE_SHEET_CSV", GOOGLE_SHEET_CSV);
  localStorage.setItem("APP_STAGE", "READY");

  warningModal.style.display = "none";
  initUI();
};

/**************************************************
 * START ACTIONS
 **************************************************/
openSheetBtn.onclick = () => {
  if (MASTER_SHEET_URL) window.open(MASTER_SHEET_URL, "_blank");
};

startAuctionBtn.onclick = () => {
  APP_STAGE = "RUNNING";
  localStorage.setItem("APP_STAGE", "RUNNING");
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
  return `
    <table class="auctionTable">
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.Item}</td>
            <td>${r.Type}</td>
            <td>${r["Base Price"]}</td>
            <td>${r["Current Bid"]}</td>
            <td>${r["Name of Bidder"]}</td>
            <td>${r.Status}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function highlightRow() {
  const rows = document.querySelectorAll(".auctionTable tbody tr");
  rows.forEach(r => r.classList.remove("active"));
  if (rows[rowIndex]) rows[rowIndex].classList.add("active");
}

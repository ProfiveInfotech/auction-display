/**************************************************
 * SAFE BOOT RULE
 * Never resume slideshow on page reload
 **************************************************/
localStorage.removeItem("APP_STAGE");

/**************************************************
 * GLOBAL STATE
 **************************************************/
let MASTER_SHEET_URL = localStorage.getItem("MASTER_SHEET_URL");
let GOOGLE_SHEET_CSV = localStorage.getItem("GOOGLE_SHEET_CSV");
let APP_STAGE = "LINK";

/**************************************************
 * CONFIG
 **************************************************/
const IMAGE_DURATION = 5;
const IMAGES_BEFORE_TABLE = 5;
const ROWS_PER_PAGE = 10;
const ROW_HIGHLIGHT_DURATION = 1;

/**************************************************
 * RUNTIME STATE
 **************************************************/
let slides = [];
let slideIndex = 0;
let slideTimer = null;
let countdownTimer = null;
let paused = false;

let tablePages = [];
let tablePageIndex = 0;
let rowIndex = 0;
let rowTimer = null;

let bidFlickerTimer = null;
let bidFlickerState = false;

/**************************************************
 * IMAGE STATE (PERSISTENT)
 **************************************************/
let imageMap = {}; // ItemCode -> objectURL
let db;

/**************************************************
 * DOM
 **************************************************/
const startScreen = document.getElementById("startScreen");
const app = document.getElementById("app");
const stage = document.querySelector(".stage");
const counter = document.getElementById("counter");
const countdownEl = document.getElementById("countdown");

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
 * BACK BUTTON
 **************************************************/
const backBtn = document.createElement("button");
backBtn.textContent = "⬅ Back";
backBtn.className = "btn secondary";
backBtn.style.marginRight = "12px";

/**************************************************
 * IMAGE PICKER
 **************************************************/
const imagePickerInput = document.createElement("input");
imagePickerInput.type = "file";
imagePickerInput.webkitdirectory = true;
imagePickerInput.multiple = true;
imagePickerInput.style.display = "none";
document.body.appendChild(imagePickerInput);

const selectImagesBtn = document.createElement("button");
selectImagesBtn.textContent = "🖼 Select Image Folder";
selectImagesBtn.className = "btn secondary";

/**************************************************
 * INDEXED DB (IMAGE PERSISTENCE)
 **************************************************/
function initDB() {
  return new Promise(resolve => {
    const req = indexedDB.open("auction_images", 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore("images", { keyPath: "key" });
    };
    req.onsuccess = e => {
      db = e.target.result;
      resolve();
    };
  });
}

function saveImage(key, blob) {
  const tx = db.transaction("images", "readwrite");
  tx.objectStore("images").put({ key, blob });
}

function loadImagesFromDB() {
  return new Promise(resolve => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const req = store.getAll();
    req.onsuccess = () => {
      imageMap = {};
      req.result.forEach(r => {
        imageMap[r.key] = URL.createObjectURL(r.blob);
      });
      resolve();
    };
  });
}

/**************************************************
 * INIT UI
 **************************************************/
async function initUI() {
  await initDB();
  await loadImagesFromDB();

  startScreen.style.display = "none";
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";

  backBtn.remove();
  selectImagesBtn.remove();

  if (APP_STAGE === "LINK") {
    startScreen.style.display = "grid";
    linkButtons.style.display = "flex";
  }

  if (APP_STAGE === "READY") {
    startScreen.style.display = "grid";
    actionButtons.style.display = "flex";
    actionButtons.prepend(selectImagesBtn);
  }

  if (APP_STAGE === "RUNNING") {
    app.style.display = "grid";
    document.querySelector(".topControls").prepend(backBtn);
    loadData();
  }
}

initUI();

/**************************************************
 * BACK ACTION
 **************************************************/
backBtn.onclick = () => {
  stopAllTimers();
  stopBidFlicker();
  paused = false;
  APP_STAGE = "LINK";
  initUI();
};

/**************************************************
 * LINK DATA FLOW
 **************************************************/
linkDataBtn.onclick = () => {
  sheetLinkInput.value = MASTER_SHEET_URL || "";
  warningModal.style.display = "flex";
};

warningOkBtn.onclick = () => {
  warningModal.style.display = "none";
};

linkConfirmBtn.onclick = async () => {
  const url = sheetLinkInput.value.trim();
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return alert("Invalid Google Sheet link");

  MASTER_SHEET_URL = url;
  GOOGLE_SHEET_CSV =
    `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;

  localStorage.setItem("MASTER_SHEET_URL", MASTER_SHEET_URL);
  localStorage.setItem("GOOGLE_SHEET_CSV", GOOGLE_SHEET_CSV);

  APP_STAGE = "READY";
  warningModal.style.display = "none";
  initUI();
};

/**************************************************
 * IMAGE LOAD
 **************************************************/
selectImagesBtn.onclick = () => imagePickerInput.click();

imagePickerInput.onchange = () => {
  imageMap = {};
  [...imagePickerInput.files].forEach(file => {
    const key = file.name.split(".")[0];
    saveImage(key, file);
    imageMap[key] = URL.createObjectURL(file);
  });
  alert("Images saved. They will persist after refresh.");
};

/**************************************************
 * ACTION BUTTONS
 **************************************************/
openSheetBtn.onclick = () => {
  if (MASTER_SHEET_URL) window.open(MASTER_SHEET_URL, "_blank");
};

startAuctionBtn.onclick = () => {
  APP_STAGE = "RUNNING";
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
 * SLIDE BUILD
 **************************************************/
function buildSlides(rows) {
  const out = [];
  let count = 0;

  for (const r of rows) {
    out.push({ type: "item", record: r, image: imageMap[r.Item] });
    count++;

    if (count % IMAGES_BEFORE_TABLE === 0) {
      out.push({ type: "table", rows });
    }
  }
  return out;
}

/**************************************************
 * SLIDE PLAYER
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
    startCountdown(IMAGE_DURATION);
    counter.textContent = `ITEM ${slideIndex + 1} / ${slides.length}`;
    slideTimer = setTimeout(nextSlide, IMAGE_DURATION * 1000);
  } else {
    playTable(slide.rows);
  }
}

/**************************************************
 * COUNTDOWN
 **************************************************/
function startCountdown(seconds) {
  let remaining = seconds;
  countdownEl.textContent = remaining;
  countdownEl.style.display = "block";

  countdownTimer = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownEl.style.display = "none";
    }
  }, 1000);
}

/**************************************************
 * TABLE LOGIC
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
    if (rowIndex >= ROWS_PER_PAGE) {
      clearInterval(rowTimer);
      nextSlide();
      return;
    }
    highlightRow();
  }, ROW_HIGHLIGHT_DURATION * 1000);
}

/**************************************************
 * RENDERING
 **************************************************/
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
      <table class="auctionTable">
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>Base Price</th>
            <th>Current Bid</th>
            <th>Bidder</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${tablePages[tablePageIndex].map(r => `
            <tr>
              <td>${r.Item}</td>
              <td>${r.Type}</td>
              <td>${r["Base Price"]}</td>
              <td>${r["Current Bid"]}</td>
              <td>${r["Name of Bidder"]}</td>
              <td>${r.Status}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
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
 * HELPERS
 **************************************************/
function highlightRow() {
  document.querySelectorAll(".auctionTable tbody tr")
    .forEach((r,i)=>r.classList.toggle("active", i===rowIndex));
}

function stopAllTimers() {
  clearTimeout(slideTimer);
  clearInterval(rowTimer);
  clearInterval(countdownTimer);
  countdownEl.style.display = "none";
}

function startBidFlicker() {
  const el = document.querySelector(".currentBid");
  if (!el) return;
  bidFlickerState = false;
  bidFlickerTimer = setInterval(() => {
    bidFlickerState = !bidFlickerState;
    el.style.color = bidFlickerState ? "#facc15" : "#22c55e";
  }, 600);
}

function stopBidFlicker() {
  clearInterval(bidFlickerTimer);
}

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  const headers = lines.shift().split(",");
  return lines.map(l => {
    const v = l.split(",");
    const o = {};
    headers.forEach((h,i)=>o[h.trim()] = v[i]?.trim() || "");
    return o;
  });
}

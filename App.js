/**************************************************
 * GOOGLE SHEET
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
let countdownTimer = null;
let paused = false;

let tablePages = [];
let tablePageIndex = 0;
let rowIndex = 0;
let rowTimer = null;

let bidFlickerTimer = null;
let bidFlickerState = false;
let imageMap = {};

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
 * IMAGE FOLDER PICKER
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
 * INIT UI
 **************************************************/
function initUI() {
  startScreen.style.display = "none";
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";

  if (selectImagesBtn.parentNode) selectImagesBtn.remove();

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
    startScreen.style.display = "none";
    app.style.display = "grid";
    loadData();
  }
}
initUI();

/**************************************************
 * LINK DATA
 **************************************************/
linkDataBtn.addEventListener("click", () => {
  sheetLinkInput.value = MASTER_SHEET_URL || "";
  warningModal.style.display = "flex";
});

warningOkBtn.onclick = () => {
  warningModal.style.display = "none";
};

linkConfirmBtn.onclick = async () => {
  const match = sheetLinkInput.value.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return alert("Invalid Google Sheet link");

  const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;

  const res = await fetch(csvUrl);
  const text = await res.text();
  if (!text.trim()) return alert("Sheet not accessible");

  MASTER_SHEET_URL = sheetLinkInput.value;
  GOOGLE_SHEET_CSV = csvUrl;
  APP_STAGE = "READY";

  localStorage.setItem("MASTER_SHEET_URL", MASTER_SHEET_URL);
  localStorage.setItem("GOOGLE_SHEET_CSV", GOOGLE_SHEET_CSV);
  localStorage.setItem("APP_STAGE", "READY");

  warningModal.style.display = "none";
  initUI();
};

/**************************************************
 * IMAGE LOAD
 **************************************************/
selectImagesBtn.onclick = () => imagePickerInput.click();

imagePickerInput.onchange = () => {
  imageMap = {};
  [...imagePickerInput.files].forEach(f => {
    imageMap[f.name.split(".")[0]] = URL.createObjectURL(f);
  });
  alert("Images loaded");
};

/**************************************************
 * ACTIONS
 **************************************************/
openSheetBtn.onclick = () => window.open(MASTER_SHEET_URL, "_blank");

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
  const res = await fetch(GOOGLE_SHEET_CSV, { cache: "no-store" });
  const rows = parseCSV(await res.text()).filter(
    r => String(r.Status).toLowerCase() === "open"
  );
  slides = buildSlides(rows);
  slideIndex = 0;
  paused = false;
  playSlide();
}

/**************************************************
 * SLIDES
 **************************************************/
function buildSlides(rows) {
  const out = [];
  let count = 0;
  for (const r of rows) {
    out.push({ type: "item", record: r, image: imageMap[r.Item] });
    count++;
    if (count % IMAGES_BEFORE_TABLE === 0) out.push({ type: "table", rows });
  }
  return out;
}

/**************************************************
 * PLAYER
 **************************************************/
function playSlide() {
  stopAllTimers();
  if (paused) return;

  const slide = slides[slideIndex];
  stage.classList.toggle("table-mode", slide.type === "table");

  if (slide.type === "item") {
    renderItem(slide);
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
    if (rowIndex >= ROWS_PER_PAGE) {
      clearInterval(rowTimer);
      nextSlide();
      return;
    }
    highlightRow();
  }, ROW_HIGHLIGHT_DURATION * 1000);
}

/**************************************************
 * RENDER
 **************************************************/
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

function renderItem(slide) {
  stage.innerHTML = `
    <div class="imageWrapper">
      ${slide.image ? `<img src="${slide.image}">` : `<div class="noImage">No Image</div>`}
    </div>
    <div class="infoPanel">
      ${Object.entries(slide.record).map(([k,v]) => `
        <div class="block">
          <div class="label">${k}</div>
          <div class="value">${v}</div>
        </div>`).join("")}
    </div>`;
}

/**************************************************
 * NAV
 **************************************************/
function nextSlide() {
  slideIndex = (slideIndex + 1) % slides.length;
  playSlide();
}
prevBtn.onclick = () => { slideIndex--; playSlide(); };
nextBtn.onclick = nextSlide;

/**************************************************
 * HELPERS
 **************************************************/
function highlightRow() {
  document.querySelectorAll(".auctionTable tbody tr")
    .forEach((r,i) => r.classList.toggle("active", i === rowIndex));
}

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
    headers.forEach((h,i) => o[h.trim()] = v[i]?.trim() || "");
    return o;
  });
}

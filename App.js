/**************************************************
 * GLOBAL STATE (PERSISTED)
 **************************************************/
let APP_STAGE = localStorage.getItem("APP_STAGE") || "LINK";
let MASTER_SHEET_URL = localStorage.getItem("MASTER_SHEET_URL");
let GOOGLE_SHEET_CSV = localStorage.getItem("GOOGLE_SHEET_CSV");

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
let slideIndex = Number(localStorage.getItem("SLIDE_INDEX") || 0);
let slideTimer = null;
let paused = false;

let tablePages = [];
let rowIndex = 0;
let rowTimer = null;

let imageMap = {};
let imagesUploaded = false;

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
 * IMAGE PICKER
 **************************************************/
const imagePickerInput = document.createElement("input");
imagePickerInput.type = "file";
imagePickerInput.webkitdirectory = true;
imagePickerInput.multiple = true;
imagePickerInput.style.display = "none";
document.body.appendChild(imagePickerInput);

const uploadImagesBtn = document.createElement("button");
uploadImagesBtn.textContent = "🖼 Upload Images (Required)";
uploadImagesBtn.className = "btn primary";

/**************************************************
 * BACK BUTTON (EXPLICIT RESET)
 **************************************************/
const backBtn = document.createElement("button");
backBtn.textContent = "⬅ Back";
backBtn.className = "btn secondary";

backBtn.onclick = () => {
  stopAllTimers();
  localStorage.clear();
  location.reload();
};

/**************************************************
 * INIT UI
 **************************************************/
function initUI() {
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";

  uploadImagesBtn.remove();
  backBtn.remove();

  if (APP_STAGE === "LINK") {
    linkButtons.style.display = "flex";
    linkButtons.prepend(uploadImagesBtn);
    linkDataBtn.disabled = !imagesUploaded;
  }

  if (APP_STAGE === "READY") {
    actionButtons.style.display = "flex";
    actionButtons.prepend(backBtn);
  }

  if (APP_STAGE === "RUNNING") {
    app.style.display = "grid";
    document.querySelector(".topControls").prepend(backBtn);
    loadData(true);
  }
}

initUI();

/**************************************************
 * IMAGE UPLOAD (MANDATORY)
 **************************************************/
uploadImagesBtn.onclick = () => imagePickerInput.click();

imagePickerInput.onchange = () => {
  imageMap = {};
  [...imagePickerInput.files].forEach(file => {
    const key = file.name.split(".")[0];
    imageMap[key] = URL.createObjectURL(file);
  });
  imagesUploaded = true;
  linkDataBtn.disabled = false;
  uploadImagesBtn.textContent = "✅ Images Uploaded";
};

/**************************************************
 * LINK DATA
 **************************************************/
linkDataBtn.onclick = () => {
  if (!imagesUploaded) return;
  warningModal.style.display = "flex";
};

warningOkBtn.onclick = () => warningModal.style.display = "none";

linkConfirmBtn.onclick = () => {
  const match = sheetLinkInput.value.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return alert("Invalid Google Sheet link");

  MASTER_SHEET_URL = sheetLinkInput.value;
  GOOGLE_SHEET_CSV = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;

  localStorage.setItem("MASTER_SHEET_URL", MASTER_SHEET_URL);
  localStorage.setItem("GOOGLE_SHEET_CSV", GOOGLE_SHEET_CSV);

  APP_STAGE = "READY";
  localStorage.setItem("APP_STAGE", "READY");

  warningModal.style.display = "none";
  initUI();
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

refreshBtn.onclick = () => loadData(false);

/**************************************************
 * LOAD DATA
 **************************************************/
async function loadData(restore = false) {
  stopAllTimers();

  const res = await fetch(GOOGLE_SHEET_CSV, { cache: "no-store" });
  const rows = parseCSV(await res.text()).filter(
    r => String(r.Status).toLowerCase() === "open"
  );

  slides = buildSlides(rows);
  if (!restore) slideIndex = 0;

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

function playSlide() {
  stopAllTimers();

  localStorage.setItem("SLIDE_INDEX", slideIndex);

  const slide = slides[slideIndex];
  stage.classList.toggle("table-mode", slide.type === "table");

  if (slide.type === "item") {
    renderItem(slide);
    slideTimer = setTimeout(nextSlide, IMAGE_DURATION * 1000);
  } else {
    playTable(slide.rows);
  }

  counter.textContent = `${slideIndex + 1} / ${slides.length}`;
}

function nextSlide() {
  slideIndex = (slideIndex + 1) % slides.length;
  playSlide();
}

prevBtn.onclick = () => {
  slideIndex = (slideIndex - 1 + slides.length) % slides.length;
  playSlide();
};
nextBtn.onclick = nextSlide;

/**************************************************
 * IMAGE + INFO PANEL (RESTORED)
 **************************************************/
function renderItem(slide) {
  stage.innerHTML = `
    <div class="imageWrapper">
      ${slide.image ? `<img src="${slide.image}">` : `<div class="noImage">No Image</div>`}
    </div>
    <div class="infoPanel">
      ${Object.entries(slide.record).map(([k, v]) => `
        <div class="block">
          <div class="label">${k}</div>
          <div class="value ${k.toLowerCase() === "current bid" ? "currentBid" : ""}">
            ${v || "-"}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

/**************************************************
 * TABLE
 **************************************************/
function playTable(rows) {
  stage.innerHTML = `
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
        ${rows.map(r => `
          <tr>
            <td>${r.Item}</td>
            <td>${r.Type}</td>
            <td>${r["Base Price"]}</td>
            <td>${r["Current Bid"]}</td>
            <td>${r["Name of Bidder"]}</td>
            <td>${r.Status}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
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
  return lines.map(line => {
    const values = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim() || "");
    return obj;
  });
}

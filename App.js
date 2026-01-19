/**************************************************
 * SESSION RESET ON NEW VISIT
 * (browser close → reopen = fresh session)
 **************************************************/
if (!sessionStorage.getItem("ACTIVE_SESSION")) {
  indexedDB.deleteDatabase("auction_images");
  sessionStorage.setItem("ACTIVE_SESSION", "1");
}

/**************************************************
 * GLOBAL STATE
 **************************************************/
let APP_STAGE = "LINK";
let MASTER_SHEET_URL = null;
let GOOGLE_SHEET_CSV = null;

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
let paused = false;

let tablePages = [];
let rowIndex = 0;
let rowTimer = null;

let imageMap = {};
let imagesUploaded = false;

/**************************************************
 * DOM
 **************************************************/
const startScreen = document.getElementById("startScreen");
const app = document.getElementById("app");
const stage = document.querySelector(".stage");

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
 * INIT UI
 **************************************************/
function initUI() {
  startScreen.style.display = "none";
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";

  backBtn.remove();
  uploadImagesBtn.remove();

  if (APP_STAGE === "LINK") {
    startScreen.style.display = "grid";
    linkButtons.style.display = "flex";
    linkButtons.prepend(uploadImagesBtn);
    linkDataBtn.disabled = !imagesUploaded;
  }

  if (APP_STAGE === "READY") {
    startScreen.style.display = "grid";
    actionButtons.style.display = "flex";
  }

  if (APP_STAGE === "RUNNING") {
    app.style.display = "grid";
    document.querySelector(".topControls").prepend(backBtn);
    loadData();
  }
}

initUI();

/**************************************************
 * BACK ACTION = FULL RESET
 **************************************************/
backBtn.onclick = () => {
  stopAllTimers();
  indexedDB.deleteDatabase("auction_images");
  sessionStorage.clear();
  location.reload();
};

/**************************************************
 * IMAGE UPLOAD (MANDATORY)
 **************************************************/
uploadImagesBtn.onclick = () => imagePickerInput.click();

imagePickerInput.onchange = () => {
  imageMap = {};
  [...imagePickerInput.files].forEach(f => {
    const key = f.name.split(".")[0];
    imageMap[key] = URL.createObjectURL(f);
  });
  imagesUploaded = true;
  linkDataBtn.disabled = false;
  uploadImagesBtn.textContent = "✅ Images Uploaded";
};

/**************************************************
 * LINK DATA (BLOCKED UNTIL IMAGES)
 **************************************************/
linkDataBtn.onclick = () => {
  if (!imagesUploaded) {
    alert("Upload images first");
    return;
  }
  warningModal.style.display = "flex";
};

warningOkBtn.onclick = () => warningModal.style.display = "none";

linkConfirmBtn.onclick = () => {
  const match = sheetLinkInput.value.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return alert("Invalid Google Sheet link");

  MASTER_SHEET_URL = sheetLinkInput.value;
  GOOGLE_SHEET_CSV =
    `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;

  APP_STAGE = "READY";
  warningModal.style.display = "none";
  initUI();
};

/**************************************************
 * ACTIONS
 **************************************************/
openSheetBtn.onclick = () => window.open(MASTER_SHEET_URL, "_blank");

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
  const res = await fetch(GOOGLE_SHEET_CSV);
  const rows = parseCSV(await res.text()).filter(
    r => String(r.Status).toLowerCase() === "open"
  );

  slides = buildSlides(rows);
  slideIndex = 0;
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
    if (count % IMAGES_BEFORE_TABLE === 0)
      out.push({ type: "table", rows });
  }
  return out;
}

function playSlide() {
  stopAllTimers();
  const slide = slides[slideIndex];
  stage.classList.toggle("table-mode", slide.type === "table");

  if (slide.type === "item") {
    renderItem(slide);
    slideTimer = setTimeout(nextSlide, IMAGE_DURATION * 1000);
  } else {
    playTable(slide.rows);
  }
}

function nextSlide() {
  slideIndex = (slideIndex + 1) % slides.length;
  playSlide();
}

/**************************************************
 * TABLE
 **************************************************/
function playTable(rows) {
  stage.innerHTML = `
    <table class="auctionTable">
      <thead>
        <tr>
          <th>Item</th><th>Type</th><th>Base</th>
          <th>Bid</th><th>Bidder</th><th>Status</th>
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
          </tr>`).join("")}
      </tbody>
    </table>`;
}

/**************************************************
 * RENDER ITEM
 **************************************************/
function renderItem(slide) {
  stage.innerHTML = `
    <div class="imageWrapper">
      ${slide.image ? `<img src="${slide.image}">` : `<div>No Image</div>`}
    </div>`;
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
    headers.forEach((h,i)=>o[h.trim()] = v[i]?.trim() || "");
    return o;
  });
}

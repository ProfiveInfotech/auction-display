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

/* LOCAL IMAGES */
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
 * MODAL
 **************************************************/
/**************************************************
 * LINK DATA BUTTON — GUARANTEED CLICK
 **************************************************/
linkDataBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  console.log("Link Your Data clicked"); // 👈 you will see this

  sheetLinkInput.value = MASTER_SHEET_URL || "";
  warningModal.style.display = "flex";
});

warningOkBtn.onclick = () => {
  warningModal.style.display = "none";
};

linkConfirmBtn.onclick = async () => {
  const url = sheetLinkInput.value.trim();
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return alert("Invalid Google Sheet link");

  const sheetId = match[1];
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  try {
    const res = await fetch(csvUrl);
    const text = await res.text();
    if (!text.trim()) throw new Error();
  } catch {
    alert("Sheet not accessible");
    return;
  }

  MASTER_SHEET_URL = url;
  GOOGLE_SHEET_CSV = csvUrl;
  APP_STAGE = "READY";

  localStorage.setItem("MASTER_SHEET_URL", url);
  localStorage.setItem("GOOGLE_SHEET_CSV", csvUrl);
  localStorage.setItem("APP_STAGE", "READY");

  warningModal.style.display = "none";
  initUI();
};

/**************************************************
 * IMAGE LOADING
 **************************************************/
selectImagesBtn.onclick = () => imagePickerInput.click();

imagePickerInput.onchange = () => {
  imageMap = {};
  [...imagePickerInput.files].forEach(file => {
    const name = file.name.split(".")[0];
    imageMap[name] = URL.createObjectURL(file);
  });
  alert("Image folder loaded successfully");
};

/**************************************************
 * ACTIONS
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
  const text = await res.text();

  const rows = parseCSV(text).filter(
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
    const image = imageMap[r.Item] || null;
    out.push({ type: "item", record: r, image });
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
    startCountdown(IMAGE_DURATION);
    counter.textContent = `IMAGE ${slideIndex + 1}/${slides.length}`;
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
 * ROW HIGHLIGHT
 **************************************************/
function highlightRow() {
  const rows = document.querySelectorAll(".auctionTable tbody tr");
  rows.forEach(r => r.classList.remove("active"));
  if (rows[rowIndex]) rows[rowIndex].classList.add("active");
}

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
}

/**************************************************
 * HELPERS
 **************************************************/
function stopAllTimers() {
  clearTimeout(slideTimer);
  clearInterval(rowTimer);
  clearInterval(countdownTimer);
  countdownEl.style.display = "none";
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


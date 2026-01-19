/**************************************************
 * INDEXED DB (IMAGES)
 **************************************************/
const DB_NAME = "auction_images";
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
  files.forEach(f => store.put(f, f.name.split(".")[0]));
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

function clearImages() {
  indexedDB.deleteDatabase(DB_NAME);
}

/**************************************************
 * GLOBAL STATE
 **************************************************/
let APP_STAGE = localStorage.getItem("APP_STAGE") || "LINK";
let MASTER_SHEET_URL = localStorage.getItem("MASTER_SHEET_URL");
let GOOGLE_SHEET_CSV = localStorage.getItem("GOOGLE_SHEET_CSV");

let imageMap = {};
let slides = [];
let slideIndex = Number(localStorage.getItem("SLIDE_INDEX") || 0);
let slideTimer = null;

/**************************************************
 * CONFIG
 **************************************************/
const IMAGE_DURATION = 5;
const IMAGES_BEFORE_TABLE = 5;

/**************************************************
 * DOM
 **************************************************/
const stage = document.querySelector(".stage");
const app = document.getElementById("app");
const counter = document.getElementById("counter");

const linkButtons = document.getElementById("linkButtons");
const actionButtons = document.getElementById("actionButtons");

const linkDataBtn = document.getElementById("linkDataBtn");
const openSheetBtn = document.getElementById("openSheetBtn");
const startAuctionBtn = document.getElementById("startAuctionBtn");

const warningModal = document.getElementById("warningModal");
const warningOkBtn = document.getElementById("warningOkBtn");
const linkConfirmBtn = document.getElementById("linkConfirmBtn");
const sheetLinkInput = document.getElementById("sheetLinkInput");

/**************************************************
 * IMAGE PICKER
 **************************************************/
const picker = document.createElement("input");
picker.type = "file";
picker.webkitdirectory = true;
picker.multiple = true;
picker.style.display = "none";
document.body.appendChild(picker);

const uploadBtn = document.createElement("button");
uploadBtn.className = "btn primary";
uploadBtn.textContent = "🖼 Upload Images (Required)";

/**************************************************
 * BACK BUTTON
 **************************************************/
const backBtn = document.createElement("button");
backBtn.className = "btn secondary";
backBtn.textContent = "⬅ Back";

backBtn.onclick = () => {
  localStorage.clear();
  clearImages();
  location.reload();
};

/**************************************************
 * INIT UI
 **************************************************/
async function initUI() {
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";

  uploadBtn.remove();
  backBtn.remove();

  imageMap = await loadImages();

  if (APP_STAGE === "LINK") {
    linkButtons.style.display = "flex";
    linkButtons.prepend(uploadBtn);
    linkDataBtn.disabled = Object.keys(imageMap).length === 0;
  }

  if (APP_STAGE === "READY") {
    actionButtons.style.display = "flex";
    actionButtons.prepend(backBtn);
  }

  if (APP_STAGE === "RUNNING") {
    app.style.display = "grid";
    document.querySelector(".topControls").prepend(backBtn);
    await loadData(true);
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
  uploadBtn.textContent = "✅ Images Uploaded";
  linkDataBtn.disabled = false;
};

/**************************************************
 * LINK DATA
 **************************************************/
linkDataBtn.onclick = () => {
  if (!Object.keys(imageMap).length) return;
  warningModal.style.display = "flex";
};

warningOkBtn.onclick = () => warningModal.style.display = "none";

linkConfirmBtn.onclick = () => {
  const m = sheetLinkInput.value.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return alert("Invalid Google Sheet link");

  MASTER_SHEET_URL = sheetLinkInput.value;
  GOOGLE_SHEET_CSV =
    `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;

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

/**************************************************
 * LOAD DATA
 **************************************************/
async function loadData(restore) {
  const res = await fetch(GOOGLE_SHEET_CSV, { cache: "no-store" });
  const rows = parseCSV(await res.text())
    .filter(r => String(r.Status).toLowerCase() === "open");

  slides = buildSlides(rows);
  if (!restore) slideIndex = 0;
  playSlide();
}

/**************************************************
 * SLIDES
 **************************************************/
function buildSlides(rows) {
  const out = [];
  let c = 0;
  for (const r of rows) {
    out.push({ type: "item", record: r, image: imageMap[r.Item] });
    c++;
    if (c % IMAGES_BEFORE_TABLE === 0) out.push({ type: "table", rows });
  }
  return out;
}

function playSlide() {
  clearTimeout(slideTimer);
  localStorage.setItem("SLIDE_INDEX", slideIndex);

  const s = slides[slideIndex];
  stage.classList.toggle("table-mode", s.type === "table");

  if (s.type === "item") {
    renderItem(s);
    slideTimer = setTimeout(nextSlide, IMAGE_DURATION * 1000);
  } else renderTable(s.rows);

  counter.textContent = `${slideIndex + 1} / ${slides.length}`;
}

function nextSlide() {
  slideIndex = (slideIndex + 1) % slides.length;
  playSlide();
}

/**************************************************
 * RENDER ITEM (IMAGE + INFO PANEL)
 **************************************************/
function renderItem(slide) {
  stage.innerHTML = `
    <div class="imageWrapper">
      <img src="${slide.image}">
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

/**************************************************
 * TABLE
 **************************************************/
function renderTable(rows) {
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
 * CSV
 **************************************************/
function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  const h = lines.shift().split(",");
  return lines.map(l => {
    const v = l.split(",");
    const o = {};
    h.forEach((k,i)=>o[k.trim()]=v[i]?.trim()||"");
    return o;
  });
}

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

/* BID FLICKER */
let bidFlickerTimer = null;
let bidFlickerState = false;

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
 * BACK BUTTON
 **************************************************/
const backBtn = document.createElement("button");
backBtn.textContent = "⬅ Back";
backBtn.className = "btn secondary";
backBtn.style.marginRight = "12px";

/**************************************************
 * INIT UI
 **************************************************/
function initUI() {
  linkButtons.style.display = "none";
  actionButtons.style.display = "none";
  app.style.display = "none";
  backBtn.remove();

  if (APP_STAGE === "LINK") {
    linkButtons.style.display = "flex";
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
function showModal() {
  warningModal.style.display = "flex";
}
function hideModal() {
  warningModal.style.display = "none";
}
warningOkBtn.onclick = hideModal;

/**************************************************
 * LINK DATA (VALIDATION — FIXED)
 **************************************************/
linkDataBtn.onclick = () => {
  sheetLinkInput.value = MASTER_SHEET_URL || "";
  showModal();
};

linkConfirmBtn.onclick = async () => {
  const url = sheetLinkInput.value.trim();

  if (!url || !url.includes("docs.google.com/spreadsheets")) {
    alert("Invalid Google Sheet link");
    return;
  }

  const parsed = parseGoogleSheetUrl(url);
  if (!parsed.sheetId) {
    alert("Invalid Google Sheet link");
    return;
  }

  const sheetId = parsed.sheetId;
  const gid = parsed.gid;
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  try {
    // Validate access by actually loading rows (works even when fetch is CORS-blocked)
    const rows = await loadSheetRows({ sheetId, gid, csvUrl });

    // DEBUG: show first row keys and count (remove later if not needed)
    alert(`DEBUG: Loaded ${rows.length} rows. Columns: ${Object.keys(rows[0] || {}).join(", ")}`);

    if (!rows.length) throw new Error("No rows returned");
  } catch (err) {
    alert("DEBUG reason: " + (err && err.message ? err.message : String(err)));
    alert("Sheet is not accessible or not published");
    return;
  }

  MASTER_SHEET_URL = url;
  GOOGLE_SHEET_CSV = csvUrl;
  APP_STAGE = "READY";

  localStorage.setItem("MASTER_SHEET_URL", url);
  localStorage.setItem("GOOGLE_SHEET_CSV", csvUrl);
  localStorage.setItem("APP_STAGE", "READY");

  hideModal();
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

  // We load rows using the same robust method used in link validation
  const parsed = parseGoogleSheetUrl(MASTER_SHEET_URL || "");
  const rowsAll = await loadSheetRows({
    sheetId: parsed.sheetId,
    gid: parsed.gid,
    csvUrl: GOOGLE_SHEET_CSV,
  });

  const rows = rowsAll.filter(r => String(r.Status).toLowerCase() === "open");

  slides = await buildSlides(rows);
  slideIndex = 0;
  paused = false;

  pauseBtn.style.display = "inline-block";
  resumeBtn.style.display = "none";

  playSlide();
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
    counter.textContent = `IMAGE ${slideIndex + 1}/${slides.length}`;
    slideTimer = setTimeout(() => {
      if (!paused) nextSlide();
    }, IMAGE_DURATION * 1000);
  } else {
    playTable(slide.rows);
  }
}

/**************************************************
 * TABLE PLAYER
 **************************************************/
function playTable(rows) {
  stopBidFlicker();

  tablePages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    tablePages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  tablePageIndex = 0;
  playTablePage();
}

function playTablePage() {
  stopAllTimers();
  if (paused) return;

  rowIndex = 0;
  drawTablePage();
  highlightRow();

  rowTimer = setInterval(() => {
    if (paused) return;

    const currentPageLen = (tablePages[tablePageIndex] || []).length;
    rowIndex++;

    if (rowIndex >= currentPageLen) {
      clearInterval(rowTimer);
      tablePageIndex++;
      if (tablePageIndex >= tablePages.length) {
        nextSlide();
        return;
      }
      playTablePage();
      return;
    }

    highlightRow();
  }, ROW_HIGHLIGHT_DURATION * 1000);
}

/**************************************************
 * NAVIGATION
 **************************************************/
function nextSlide() {
  paused = false;
  slideIndex = (slideIndex + 1) % slides.length;
  playSlide();
}

function prevSlide() {
  paused = false;
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
  bidEl.style.color = "#22c55e"; // green

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
  slideTimer = null;
  rowTimer = null;
}

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  const headers = lines.shift().split(",").map(h => h.trim());
  return lines.map(l => {
    const v = l.split(",");
    const o = {};
    headers.forEach((h, i) => (o[h] = v[i]?.trim() || ""));
    return o;
  });
}

async function buildSlides(rows) {
  const out = [];
  let count = 0;

  for (const r of rows) {
    let image = null;
    for (const ext of ["jpg", "png", "jpeg", "webp"]) {
      const p = `Images/${r.Item}.${ext}`;
      if (await imageExists(p)) {
        image = p;
        break;
      }
    }

    out.push({ type: "item", record: r, image });
    count++;
    if (count % IMAGES_BEFORE_TABLE === 0) {
      out.push({ type: "table", rows });
    }
  }
  return out;
}

function renderItem(slide) {
  stage.innerHTML = `
    <div class="imageWrapper">
      ${slide.image ? `<img src="${slide.image}">` : `<div class="noImage">Image not found</div>`}
    </div>
    <div class="infoPanel">
      ${Object.entries(slide.record)
        .map(
          ([k, v]) => `
        <div class="block">
          <div class="label">${k}</div>
          <div class="value ${k.toLowerCase() === "current bid" ? "currentBid" : ""}">
            ${v || "-"}
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

function drawTablePage() {
  stage.innerHTML = `
    <div class="tableContainer">
      ${tableHTML(tablePages[tablePageIndex])}
    </div>`;

  // Counter update for table playback
  const totalPages = tablePages.length || 1;
  const pageNo = Math.min(tablePageIndex + 1, totalPages);
  counter.textContent = `TABLE ${pageNo}/${totalPages}`;
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
  if (rows[rowIndex]) {
    rows[rowIndex].classList.add("active");

    // Smooth-scroll inside the fixed table holder (not the whole page)
    const container = document.querySelector(".tableContainer");
    if (container) {
      const r = rows[rowIndex];
      const target = r.offsetTop - (container.clientHeight / 2) + (r.clientHeight / 2);
      container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    } else {
      rows[rowIndex].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

function imageExists(src) {
  return new Promise(r => {
    const i = new Image();
    i.onload = () => r(true);
    i.onerror = () => r(false);
    i.src = src;
  });
}

/**************************************************
 * GOOGLE SHEET LOADING (CORS-SAFE)
 * - First tries fetch(csvUrl)
 * - If blocked, falls back to GViz via <script> (no CORS)
 **************************************************/
function parseGoogleSheetUrl(url) {
  const out = { sheetId: null, gid: null };
  const m = String(url || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) out.sheetId = m[1];
  const g = String(url || "").match(/[?&]gid=(\d+)/);
  if (g) out.gid = g[1];
  return out;
}

async function loadSheetRows({ sheetId, gid, csvUrl }) {
  if (!sheetId) throw new Error("Missing sheetId");

  // 1) Try direct fetch of CSV (works on some hosted setups)
  try {
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const text = (await res.text()).trim();

    // If Google returns HTML interstitial/login page
    if (!text || /^<!doctype\s+html/i.test(text) || /<html/i.test(text)) {
      throw new Error("Google returned HTML instead of CSV");
    }

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) throw new Error("CSV has only header or no data");

    return parseCSV(text);
  } catch (e) {
    // If it's a CORS/network-style failure, try GViz script fallback.
    const msg = (e && e.message) ? e.message : String(e);
    if (!/failed to fetch|networkerror|typeerror/i.test(msg)) {
      // Non-network error: still try GViz once, then rethrow if needed.
    }
  }

  // 2) GViz script fallback (works cross-origin)
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${gid ? `gid=${gid}&` : ""}tqx=out:json`;
  const resp = await loadGvizViaScript(gvizUrl);
  const rows = gvizResponseToRows(resp);
  if (!rows.length) throw new Error("GViz returned no rows (sheet empty or inaccessible)");
  return rows;
}

function loadGvizViaScript(src) {
  return new Promise((resolve, reject) => {
    // Ensure namespace exists; GViz response calls google.visualization.Query.setResponse(...)
    window.google = window.google || {};
    window.google.visualization = window.google.visualization || {};
    window.google.visualization.Query = window.google.visualization.Query || {};

    let done = false;

    // Install a one-time handler
    window.google.visualization.Query.setResponse = (resp) => {
      done = true;
      cleanup();
      resolve(resp);
    };

    const s = document.createElement("script");
    s.src = src;
    s.async = true;

    const timeout = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error("Timeout loading Google Sheet (GViz)") );
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    }

    s.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error("Failed to load Google Sheet (GViz script error)"));
    };

    document.head.appendChild(s);
  });
}

function gvizResponseToRows(resp) {
  if (!resp || resp.status !== "ok" || !resp.table) {
    throw new Error("GViz response not ok (sheet may be protected/blocked)");
  }

  const cols = resp.table.cols || [];
  const headers = cols.map((c, i) => (c && c.label ? c.label.trim() : `COL_${i + 1}`));
  const out = [];

  const rws = resp.table.rows || [];
  for (const r of rws) {
    const obj = {};
    const cells = (r && r.c) ? r.c : [];
    headers.forEach((h, idx) => {
      const cell = cells[idx];
      const val = cell ? (cell.f != null ? cell.f : (cell.v != null ? String(cell.v) : "")) : "";
      obj[h] = val;
    });
    out.push(obj);
  }
  return out;
}

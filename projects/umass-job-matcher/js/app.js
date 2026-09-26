// Portfolio demo build: the real app POSTs to a FastAPI backend that embeds the
// resume with all-MiniLM-L6-v2 and ranks jobs in Supabase via pgvector. GitHub
// Pages can't host that, so fetchPage() below ranks the bundled SAMPLE_JOBS
// (js/jobs.js) in the browser with TF-IDF cosine similarity instead.

const resumeEl = document.getElementById("resume");
const button = document.getElementById("match-btn");
const spinner = document.getElementById("btn-spinner");
const label = document.getElementById("btn-label");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const loadMoreBtn = document.getElementById("load-more-btn");
const loadMoreSpinner = document.getElementById("load-more-spinner");
const loadMoreLabel = document.getElementById("load-more-label");
const resultsMetaEl = document.getElementById("results-meta");
const resultsLayout = document.getElementById("results-layout");
const detailEl = document.getElementById("job-detail");
const fileInput = document.getElementById("resume-files");
const dropzone = document.getElementById("dropzone");
const fileListEl = document.getElementById("file-list");
const filterEls = {
  jobType: document.getElementById("filter-job-type"),
  funding: document.getElementById("filter-funding"),
  minPay: document.getElementById("filter-min-pay"),
};

const PAGE_SIZE = 5;

// Pagination state for the current search. `searchId` is bumped by every new
// search so a slow "Load More" response from an older search is discarded
// instead of being appended to the new results.
let searchId = 0;
let activeController = null;
let currentQuery = null; // request body (minus offset/limit) of the search on screen
let nextOffset = 0;
let hasMore = false;
let totalMatches = 0;
let loadingMore = false;
let hasSearched = false; // lets filter changes re-run the search, even mid-request

// Every job loaded so far (across pages) and the one shown in the detail pane.
let jobs = [];
let selectedIndex = -1;

// Below this width the detail pane is a full-screen sheet instead of a column.
const compactLayout = window.matchMedia("(max-width: 1023.98px)");

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setLoading(loading) {
  button.disabled = loading;
  spinner.classList.toggle("hidden", !loading);
  label.textContent = loading ? "Matching…" : "Find Matches";
}

function showStatus(html, tone = "muted") {
  const tones = {
    muted: "text-stone-500",
    error: "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700",
  };
  statusEl.className = `mt-8 text-center text-sm ${tones[tone]}`;
  statusEl.innerHTML = html;
}

function hideStatus() {
  statusEl.className = "mt-8 hidden";
}

function renderSkeletons() {
  resultsLayout.classList.remove("hidden");
  resultsEl.innerHTML = Array.from({ length: 5 }, () => `
    <li class="animate-pulse border-b border-stone-100 px-4 py-4" aria-hidden="true">
      <div class="mb-2 h-4 w-2/3 rounded bg-stone-200"></div>
      <div class="mb-2 h-3 w-1/3 rounded bg-stone-100"></div>
      <div class="h-3 w-1/4 rounded bg-stone-100"></div>
    </li>`).join("");
  detailEl.innerHTML = `
    <div class="animate-pulse p-6" aria-hidden="true">
      <div class="mb-3 h-6 w-1/2 rounded bg-stone-200"></div>
      <div class="mb-6 h-3 w-1/4 rounded bg-stone-100"></div>
      ${'<div class="mb-2 h-3 w-full rounded bg-stone-100"></div>'.repeat(6)}
    </div>`;
}

/* ------------------------------------------------------------------------ *
 * Resume files: multi-file PDF / DOCX / TXT upload, parsed in the browser.
 * ------------------------------------------------------------------------ */

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

// { id, file, status: "parsing" | "ready" | "error", text, error, promise }
let resumeFiles = [];
let nextFileId = 0;

// Parser libraries are only downloaded the first time a file of that type is added.
const scriptCache = {};
function loadScript(src) {
  scriptCache[src] ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => {
      delete scriptCache[src];
      reject(new Error("Couldn't load the file parser. Check your connection."));
    };
    document.head.appendChild(el);
  });
  return scriptCache[src];
}

function fileKind(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === "txt" || file.type === "text/plain") return "txt";
  return null;
}

async function parsePdf(file) {
  await loadScript(PDFJS_URL);
  const { pdfjsLib } = window;
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

async function parseDocx(file) {
  await loadScript(MAMMOTH_URL);
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

async function parseFile(file) {
  const parsers = { pdf: parsePdf, docx: parseDocx, txt: (f) => f.text() };
  const text = (await parsers[fileKind(file)](file)).replace(/\s+/g, " ").trim();
  if (!text) throw new Error("No readable text found (scanned image?)");
  return text;
}

function addFiles(fileList) {
  for (const file of fileList) {
    const duplicate = resumeFiles.some((f) => f.file.name === file.name && f.file.size === file.size);
    if (duplicate) continue;

    const entry = { id: nextFileId++, file, status: "parsing", text: "", error: "" };
    if (!fileKind(file)) {
      Object.assign(entry, { status: "error", error: "Unsupported type — use PDF, DOCX or TXT" });
    } else if (file.size > MAX_FILE_BYTES) {
      Object.assign(entry, { status: "error", error: "File is larger than 10 MB" });
    } else {
      entry.promise = parseFile(file)
        .then((text) => Object.assign(entry, { status: "ready", text }))
        .catch((err) => Object.assign(entry, { status: "error", error: err.message || "Couldn't read this file" }))
        .finally(renderFileList);
    }
    resumeFiles.push(entry);
  }
  renderFileList();
}

function removeFile(id) {
  resumeFiles = resumeFiles.filter((f) => f.id !== id);
  renderFileList();
}

function renderFileList() {
  const statusText = {
    parsing: `<span class="text-stone-400">Reading…</span>`,
    ready: `<span class="text-emerald-600">Ready</span>`,
  };
  fileListEl.innerHTML = resumeFiles.map((f) => `
    <li class="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
      <span class="tag shrink-0 uppercase">${escapeHtml(fileKind(f.file) || "?")}</span>
      <span class="min-w-0 flex-1 truncate text-stone-700" title="${escapeHtml(f.file.name)}">${escapeHtml(f.file.name)}</span>
      <span class="shrink-0 text-xs">${f.status === "error" ? `<span class="text-red-600">${escapeHtml(f.error)}</span>` : statusText[f.status]}</span>
      <button type="button" data-remove-file="${f.id}" class="shrink-0 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Remove ${escapeHtml(f.file.name)}">✕</button>
    </li>`).join("");
}

// Pasted text plus the text of every successfully parsed file, waiting for any
// files that are still being read.
async function collectResumeText() {
  await Promise.all(resumeFiles.map((f) => f.promise).filter(Boolean));
  const parts = [resumeEl.value.trim(), ...resumeFiles.filter((f) => f.status === "ready").map((f) => f.text)];
  return parts.filter(Boolean).join("\n\n");
}

/* ------------------------------------------------------------------------ *
 * Job cards
 * ------------------------------------------------------------------------ */

// search_score is cosine similarity (0–1). Fall back to older field names, and
// accept values already expressed as percentages.
function toPercent(job) {
  const raw = job.search_score ?? job.similarity ?? job.score;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const pct = n > 1 ? n : n * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function badgeClass(pct) {
  if (pct === null) return "badge-low";
  if (pct >= 60) return "badge-high";
  if (pct >= 35) return "badge-mid";
  return "badge-low";
}

function workStudyTag(isWorkStudy) {
  if (isWorkStudy === true) return `<span class="tag tag-accent">Work-Study</span>`;
  if (isWorkStudy === false) return `<span class="tag">Not Work-Study</span>`;
  return "";
}

function locationTag(onCampus) {
  if (onCampus === true) return `<span class="tag tag-accent">On-Campus</span>`;
  if (onCampus === false) return `<span class="tag">Off-Campus</span>`;
  return "";
}

// Only allow http(s)/mailto links from data into href attributes.
function safeHref(url, schemes = ["http:", "https:"]) {
  try {
    const parsed = new URL(url);
    return schemes.includes(parsed.protocol) ? escapeHtml(parsed.href) : null;
  } catch {
    return null;
  }
}

function payTag(job) {
  const min = Number(job.pay_min);
  const max = Number(job.pay_max);
  if (!Number.isFinite(min)) return "";
  const fmt = (n) => `$${n % 1 ? n.toFixed(2) : n}`;
  const range = Number.isFinite(max) && max > min ? `${fmt(min)}–${fmt(max)}` : fmt(min);
  const note = job.pay_is_estimated ? " (est.)" : "";
  return `<span class="tag">${range}/hr${note}</span>`;
}

function textTag(value) {
  return value && value !== "Not Specified" ? `<span class="tag">${escapeHtml(value)}</span>` : "";
}

function hoursTag(hours) {
  if (!hours || hours === "Not Specified") return "";
  return textTag(/hour|hr/i.test(hours) ? hours : `${hours} hrs/wk`);
}

// The scraper stores no category, so derive one from the title/department
// (checked first, most specific signal) and then the description + skills.
// Replaces the old "ID 123456" tag, which told students nothing useful.
const CATEGORY_RULES = [
  ["Tutoring & Education", /tutor|teach|instruct|education|lesson|classroom|mentor|\bTA\b/i],
  ["Tech & IT", /\bIT\b|computer|software|help ?desk|web|developer|programm|technolog|network|data (?:entry|analy)/i],
  ["Research & Labs", /research|\blab\b|laborator/i],
  ["Dining & Food Service", /dining|food|kitchen|cook|cafe|catering|barista|chef|dish/i],
  ["Childcare", /child ?care|babysit|nanny|toddler|children/i],
  ["Marketing & Media", /marketing|social media|graphic|design|video|photograph|communications|content/i],
  ["Recreation & Fitness", /lifeguard|recreation|fitness|athletic|sports|coach|intramural/i],
  ["Facilities & Grounds", /custod|janitor|grounds|landscap|maintenance|facilit|mover|yard ?work|garden/i],
  ["Customer Service & Retail", /retail|cashier|customer service|sales|store|box office|ticket/i],
  ["Office & Admin", /office|admin|clerical|reception|front desk|secretar|assistant/i],
  ["Events", /\bevents?\b/i],
];

function jobCategory(job) {
  const primary = `${job.title} ${job.department}`;
  const secondary = `${job.description} ${(job.skills || []).join(" ")}`;
  for (const text of [primary, secondary]) {
    const hit = CATEGORY_RULES.find(([, re]) => re.test(text));
    if (hit) return hit[0];
  }
  return null;
}

function categoryTag(job) {
  const category = jobCategory(job);
  return category ? `<span class="tag tag-accent">${escapeHtml(category)}</span>` : "";
}

// `description` is the scraper's summary, which ends with "Skills: a, b, c." —
// those already render as tags, so drop the duplicate sentence.
function descriptionText(job) {
  const text = job.description || job.short_description || "";
  return text.replace(/\s*Skills:[^.]*\.?\s*$/, "").trim();
}

function locationText(onCampus) {
  if (onCampus === true) return "On-Campus";
  if (onCampus === false) return "Off-Campus";
  return "";
}

/* ------------------------------------------------------------------------ *
 * Two-pane results: compact cards on the left, full posting on the right.
 * ------------------------------------------------------------------------ */

// Sidebar card: just enough to scan — title, department, location, match.
function renderListItem(job, index) {
  const pct = toPercent(job);
  const meta = [locationText(job.on_campus), job.is_work_study === true ? "Work-Study" : ""].filter(Boolean).join(" · ");
  return `
    <li id="job-item-${index}" class="job-item" role="option" aria-selected="false" tabindex="-1" data-index="${index}">
      <span class="rank-dot mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">${index + 1}</span>
      <div class="min-w-0 flex-1">
        <p class="job-item-title">${escapeHtml(job.title)}</p>
        <p class="mt-0.5 truncate text-xs text-stone-600">${escapeHtml(job.department)}</p>
        ${meta ? `<p class="mt-0.5 text-xs text-stone-400">${escapeHtml(meta)}</p>` : ""}
      </div>
      ${pct === null ? "" : `<span class="${badgeClass(pct)} h-fit shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold">${pct}%</span>`}
    </li>`;
}

// Detail pane: the full posting for one job.
function renderDetail(job) {
  const pct = toPercent(job);
  const postingHref = safeHref(job.url);
  const applyHref = safeHref(job.apply_url) || postingHref;
  const mailHref = safeHref(job.mailto_url, ["mailto:"]);
  const skills = (job.skills || []).map((s) => `<span class="tag tag-accent">${escapeHtml(s)}</span>`).join("");
  const title = postingHref
    ? `<a href="${postingHref}" target="_blank" rel="noopener noreferrer" class="hover:underline">${escapeHtml(job.title)}</a>`
    : escapeHtml(job.title);

  return `
    <article class="job-detail-content">
      <div class="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <button type="button" class="job-detail-back mb-3 items-center gap-1 text-sm font-medium text-stone-600 hover:text-stone-900" data-close-detail>
          <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Back to results
        </button>
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-xl font-semibold leading-snug text-stone-900 [overflow-wrap:anywhere]">${title}</h2>
            <p class="mt-1 text-sm text-stone-600">${escapeHtml(job.department)}</p>
          </div>
          ${pct === null ? "" : `<span class="${badgeClass(pct)} shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold">${pct}% Match</span>`}
        </div>
        ${applyHref || mailHref ? `
        <div class="card-actions mt-4 flex flex-wrap gap-2">
          ${applyHref ? `<a href="${applyHref}" target="_blank" rel="noopener noreferrer" class="btn-maroon rounded-full px-5 py-2 text-sm font-semibold">Apply Now ↗</a>` : ""}
          ${mailHref ? `<a href="${mailHref}" class="rounded-full border border-maroon bg-white px-5 py-2 text-sm font-semibold text-maroon hover:bg-stone-50">Email Contact</a>` : ""}
        </div>` : ""}
      </div>

      <div class="px-4 py-5 sm:px-6">
        <div class="flex flex-wrap gap-2">
          ${categoryTag(job)}
          ${payTag(job)}
          ${workStudyTag(job.is_work_study)}
          ${locationTag(job.on_campus)}
          ${hoursTag(job.hours_per_week)}
          ${textTag(job.hiring_period)}
        </div>

        ${pct === null ? "" : `
        <div class="mt-5">
          <div class="mb-1 flex justify-between text-xs text-stone-500"><span>Resume match</span><span>${pct}%</span></div>
          <div class="h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div class="score-bar h-full rounded-full" style="width: ${pct}%"></div>
          </div>
        </div>`}

        <h3 class="mt-6 text-base font-semibold text-stone-900">About the job</h3>
        <p class="job-detail-desc mt-2 text-sm leading-relaxed text-stone-700">${escapeHtml(descriptionText(job)) || '<span class="text-stone-400">No description provided.</span>'}</p>

        ${skills ? `
        <h3 class="mt-6 text-base font-semibold text-stone-900">Skills</h3>
        <div class="mt-2 flex flex-wrap gap-2">${skills}</div>` : ""}
      </div>
    </article>`;
}

function renderEmptyDetail() {
  detailEl.innerHTML = `<div class="job-detail-empty">Select a job to see its details.</div>`;
}

// Highlight card `index` and show its posting. `openSheet` slides the detail
// sheet up on small screens (a real click/keypress, not the auto-select that
// happens when results first arrive).
function selectJob(index, { openSheet = false, focusItem = false } = {}) {
  const job = jobs[index];
  if (!job) return;

  const prev = document.getElementById(`job-item-${selectedIndex}`);
  prev?.setAttribute("aria-selected", "false");
  prev?.setAttribute("tabindex", "-1");

  const item = document.getElementById(`job-item-${index}`);
  item.setAttribute("aria-selected", "true");
  item.setAttribute("tabindex", "0");
  resultsEl.setAttribute("aria-activedescendant", item.id);
  item.scrollIntoView({ block: "nearest" });
  if (focusItem) item.focus({ preventScroll: true });

  if (index !== selectedIndex) {
    selectedIndex = index;
    detailEl.innerHTML = renderDetail(job); // fresh node replays the pop-in animation
    detailEl.scrollTop = 0;
  }

  if (openSheet && compactLayout.matches) openDetailSheet();
}

function openDetailSheet() {
  detailEl.classList.add("is-open");
  document.body.classList.add("detail-open");
  detailEl.querySelector("[data-close-detail]")?.focus({ preventScroll: true });
}

function closeDetailSheet() {
  if (!detailEl.classList.contains("is-open")) return;
  detailEl.classList.remove("is-open");
  document.body.classList.remove("detail-open");
  document.getElementById(`job-item-${selectedIndex}`)?.focus({ preventScroll: true });
}

// Arrow keys move through the list like LinkedIn's; Enter/Space opens the
// posting (which matters on small screens, where it's a separate sheet).
function onListKeydown(e) {
  const last = jobs.length - 1;
  const moves = {
    ArrowDown: Math.min(selectedIndex + 1, last),
    ArrowUp: Math.max(selectedIndex - 1, 0),
    Home: 0,
    End: last,
  };
  if (e.key in moves) {
    e.preventDefault();
    selectJob(moves[e.key], { focusItem: true });
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    selectJob(selectedIndex, { openSheet: true });
  }
}

/* ------------------------------------------------------------------------ *
 * Search + "Load More" pagination
 * ------------------------------------------------------------------------ */

function currentFilters() {
  const minPay = filterEls.minPay.value;
  return {
    job_type: filterEls.jobType.value,
    funding: filterEls.funding.value,
    min_pay: minPay === "" ? null : Number(minPay),
  };
}

function hasActiveFilters() {
  const f = currentFilters();
  return f.job_type !== "all" || f.funding !== "all" || f.min_pay !== null;
}

/* ------------------------------------------------------------------------ *
 * In-browser ranking (stands in for /api/match in the demo)
 * ------------------------------------------------------------------------ */

const STOPWORDS = new Set("a an and are as at be but by for from has have i in is it its me my of on or our so that the their them this to up us we with you your will can am want looking job work experience".split(" "));

// A light touch of "semantic" matching: related words also emit a shared concept
// token, so "Java" on a resume can meet "programming" in a posting.
const CONCEPTS = {
  code: /^(java|python|javascript|js|c\+\+|cpp|html|css|git|github|react|sql|programm\w*|coding|code|software|developer|develop\w*|script\w*|web)$/,
  tech: /^(computer\w*|tech\w*|it|troubleshoot\w*|help|desk|hardware|network\w*|windows|macos|linux|support)$/,
  data: /^(data|analy\w*|statistic\w*|excel|spreadsheet\w*|pandas|numpy|machine|learning|ml|ai|pytorch|research\w*)$/,
  math: /^(math\w*|calculus|algebra|linear|statistic\w*|proof\w*)$/,
  teach: /^(tutor\w*|teach\w*|grad\w*|mentor\w*|ta|instruct\w*|explain\w*|lesson\w*)$/,
  food: /^(dining|food|cook\w*|kitchen|chef|cafe|café|barista|restaurant|server|serv\w*)$/,
  service: /^(customer\w*|cashier|register|cash|retail|sales|patron\w*|guest\w*|front)$/,
  design: /^(design\w*|graphic\w*|photoshop|illustrator|canva|adobe|photograph\w*|video\w*|art\w*)$/,
  media: /^(social|media|instagram|tiktok|marketing|content|caption\w*|writ\w*)$/,
  sport: /^(sport\w*|athlet\w*|fitness|gym|lifeguard\w*|swim\w*|squash|soccer|basketball|volleyball|referee|coach\w*|varsity|captain)$/,
  lead: /^(lead\w*|captain|president|manag\w*|organiz\w*|mentor\w*)$/,
  kids: /^(child\w*|kid\w*|babysit\w*|camp|counselor)$/,
  outdoor: /^(landscap\w*|garden\w*|outdoor\w*|mow\w*|grounds|physical|lifting)$/,
};

function tokenize(text) {
  const words = String(text).toLowerCase().match(/[a-z][a-z+#]*/g) || [];
  const out = [];
  for (const raw of words) {
    if (STOPWORDS.has(raw) || raw.length < 2) continue;
    out.push(raw.replace(/(ing|ed|es|s)$/, "") || raw);
    for (const [concept, re] of Object.entries(CONCEPTS)) if (re.test(raw)) out.push(`#${concept}`);
  }
  return out;
}

const jobText = (job) => `${job.title} ${job.title} ${job.department} ${job.description} ${job.skills.join(" ")} ${job.skills.join(" ")}`;
const jobTokens = SAMPLE_JOBS.map((job) => tokenize(jobText(job)));

// Smoothed IDF over the sample postings.
const idf = new Map();
for (const tokens of jobTokens) for (const t of new Set(tokens)) idf.set(t, (idf.get(t) || 0) + 1);
for (const [t, df] of idf) idf.set(t, Math.log((1 + SAMPLE_JOBS.length) / (1 + df)) + 1);

function tfidf(tokens) {
  const vec = new Map();
  for (const t of tokens) if (idf.has(t)) vec.set(t, (vec.get(t) || 0) + idf.get(t));
  let norm = 0;
  for (const v of vec.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [t, v] of vec) vec.set(t, v / norm);
  return vec;
}

const jobVectors = jobTokens.map(tfidf);

function cosine(a, b) {
  let dot = 0;
  for (const [t, v] of a) dot += v * (b.get(t) || 0);
  return dot;
}

// Mirrors passes_filters() in backend/main.py.
function passesFilters(job, query) {
  if (query.job_type === "on_campus" && job.on_campus !== true) return false;
  if (query.job_type === "off_campus" && job.on_campus !== false) return false;
  if (query.funding === "work_study" && job.is_work_study !== true) return false;
  if (query.funding === "non_work_study" && job.is_work_study !== false) return false;
  if (query.min_pay !== null) {
    const top = job.pay_max ?? job.pay_min;
    if (top == null || top < query.min_pay) return false;
  }
  return true;
}

const rankCache = new Map();
function rankAll(resume) {
  if (!rankCache.has(resume)) {
    const q = tfidf(tokenize(resume));
    // sqrt spreads raw TF-IDF cosines (mostly 0–0.4) into a range closer to what
    // sentence embeddings produce, so the match badges read sensibly.
    const ranked = SAMPLE_JOBS
      .map((job, i) => ({ ...job, search_score: Math.min(0.97, Math.sqrt(cosine(q, jobVectors[i]))) }))
      .sort((a, b) => b.search_score - a.search_score);
    rankCache.set(resume, ranked);
  }
  return rankCache.get(resume);
}

// Same response shape as POST /api/match, with a short delay so the loading
// states still show.
async function fetchPage(query, offset, signal) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 450);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
  const filtered = rankAll(query.resume).filter((job) => job.search_score > 0 && passesFilters(job, query));
  const matches = filtered.slice(offset, offset + PAGE_SIZE);
  return { matches, offset, total: filtered.length, has_more: offset + matches.length < filtered.length };
}

function errorMessage(err) {
  return escapeHtml(err.message);
}

function setLoadMoreLoading(loading) {
  loadingMore = loading;
  loadMoreBtn.disabled = loading;
  loadMoreSpinner.classList.toggle("hidden", !loading);
  loadMoreLabel.textContent = loading ? "Loading…" : "Load More Jobs";
}

function updatePaginationUi() {
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  resultsMetaEl.textContent = jobs.length ? `Showing ${jobs.length} of ${totalMatches} matches` : "";
}

// Append one page of results to the list and advance the pagination cursor.
// The first page auto-selects its top match so the detail pane is never blank.
function appendPage(data) {
  const matches = Array.isArray(data?.matches) ? data.matches : [];
  const startIndex = jobs.length;
  jobs.push(...matches);
  resultsEl.insertAdjacentHTML("beforeend", matches.map((job, i) => renderListItem(job, startIndex + i)).join(""));

  nextOffset = (data?.offset ?? nextOffset) + matches.length;
  hasMore = Boolean(data?.has_more);
  totalMatches = data?.total ?? jobs.length;
  updatePaginationUi();
  if (selectedIndex === -1) selectJob(0);
  return matches.length ? startIndex : -1;
}

function resetResults() {
  currentQuery = null;
  nextOffset = 0;
  hasMore = false;
  totalMatches = 0;
  jobs = [];
  selectedIndex = -1;
  closeDetailSheet();
  resultsEl.innerHTML = "";
  resultsEl.removeAttribute("aria-activedescendant");
  renderEmptyDetail();
  resultsLayout.classList.add("hidden");
  setLoadMoreLoading(false);
  updatePaginationUi();
}

async function findMatches() {
  activeController?.abort();
  const id = ++searchId;
  hasSearched = true;

  setLoading(true);
  const resume = await collectResumeText();
  if (id !== searchId) return;
  if (!resume) {
    setLoading(false);
    resetResults();
    showStatus("Upload a resume file or paste your resume text first.", "error");
    resumeEl.focus();
    return;
  }

  const controller = (activeController = new AbortController());
  resetResults();
  const query = { resume, ...currentFilters() };
  showStatus("Finding your best campus matches…");
  renderSkeletons();

  try {
    const data = await fetchPage(query, 0, controller.signal);
    if (id !== searchId) return;
    resultsEl.innerHTML = "";
    currentQuery = query;
    if (!data?.matches?.length) {
      resultsLayout.classList.add("hidden");
      showStatus(hasActiveFilters() ? "No jobs match these filters. Try loosening them." : "No matching jobs found.");
      return;
    }
    hideStatus();
    appendPage(data);
  } catch (err) {
    if (err.name === "AbortError" || id !== searchId) return;
    resetResults();
    showStatus(errorMessage(err), "error");
  } finally {
    if (id === searchId) setLoading(false);
  }
}

async function loadMore() {
  if (loadingMore || !hasMore || !currentQuery) return;
  const id = searchId;
  setLoadMoreLoading(true);
  try {
    const data = await fetchPage(currentQuery, nextOffset, activeController?.signal);
    if (id !== searchId) return; // a new search started while this page was loading
    const firstNew = appendPage(data);
    // Move to the first new card for keyboard / screen-reader users.
    if (firstNew !== -1) selectJob(firstNew, { focusItem: true });
  } catch (err) {
    if (err.name === "AbortError" || id !== searchId) return;
    resultsMetaEl.innerHTML = `<span class="text-red-600">Couldn't load more jobs: ${errorMessage(err)}</span>`;
  } finally {
    if (id === searchId) setLoadMoreLoading(false);
  }
}

/* ------------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------------ */

button.addEventListener("click", findMatches);
loadMoreBtn.addEventListener("click", loadMore);
resumeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) findMatches();
});

// Filters re-run the search that's on screen; before the first search they
// just wait to be sent with it.
Object.values(filterEls).forEach((el) =>
  el.addEventListener("change", () => {
    if (hasSearched) findMatches();
  })
);

resultsEl.addEventListener("click", (e) => {
  const item = e.target.closest(".job-item");
  if (item) selectJob(Number(item.dataset.index), { openSheet: true });
});
resultsEl.addEventListener("keydown", onListKeydown);

detailEl.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-detail]")) closeDetailSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetailSheet();
});
// Growing past the breakpoint turns the sheet back into a column.
compactLayout.addEventListener("change", (e) => {
  if (!e.matches) closeDetailSheet();
});

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = ""; // allow re-selecting the same file after removing it
});

fileListEl.addEventListener("click", (e) => {
  const removeBtn = e.target.closest("[data-remove-file]");
  if (removeBtn) removeFile(Number(removeBtn.dataset.removeFile));
});

["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragover");
  })
);
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    if (type === "dragleave" && dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove("is-dragover");
  })
);
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

// A file dropped just outside the zone would otherwise make the browser navigate away.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// Demo only: fill in an example resume and run the search.
const SAMPLE_RESUME = `Freshman studying Computer Science and Math. Comfortable programming in Java and Python, some HTML/CSS/JavaScript from building a personal website. Took linear algebra and calculus. Varsity squash captain in high school. Looking for a campus tech job, troubleshooting or helping with software or data.`;
document.getElementById("sample-btn").addEventListener("click", () => {
  resumeEl.value = SAMPLE_RESUME;
  findMatches();
});

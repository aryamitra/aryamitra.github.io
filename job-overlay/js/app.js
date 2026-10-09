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
const loadMoreErrorEl = document.getElementById("load-more-error");
const resultsLayout = document.getElementById("results-layout");
const detailEl = document.getElementById("job-detail");
const fileInput = document.getElementById("resume-files");
const dropzone = document.getElementById("dropzone");
const fileListEl = document.getElementById("file-list");
const filterEls = {
  jobType: document.getElementById("filter-job-type"),
  remote: document.getElementById("filter-remote"),
  city: document.getElementById("filter-city"),
  funding: document.getElementById("filter-funding"),
  minPay: document.getElementById("filter-min-pay"),
  maxHours: document.getElementById("filter-max-hours"),
  hiringPeriod: document.getElementById("filter-hiring-period"),
  exclude: document.getElementById("filter-exclude"),
  keywords: document.getElementById("filter-keywords"),
  minHours: document.getElementById("filter-min-hours"),
  busRoute: document.getElementById("filter-bus-route"),
  sort: document.getElementById("sort-by"),
  listedPay: document.getElementById("filter-listed-pay"),
};
const filterSummaryEl = document.getElementById("filter-summary");
const trackerPanel = document.getElementById("tracker-panel");
const trackerListEl = document.getElementById("tracker-list");
const rejectedPanel = document.getElementById("rejected-panel");
const rejectedListEl = document.getElementById("rejected-list");

/* ------------------------------------------------------------------------ *
 * Local-only storage. Filters, the application tracker and "not a fit"
 * feedback live in this browser's localStorage; nothing is sent to a server
 * except the filter values and rejected job IDs needed to run a search.
 * ------------------------------------------------------------------------ */

const STORE = {
  filters: "ujm.filters.v1",
  rejected: "ujm.rejected.v1",
  tracker: "ujm.tracker.v1",
};

function loadStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage full: the app still works, it just won't remember */
  }
}

function clearStores() {
  try {
    Object.values(STORE).forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

const FILTER_DEFAULTS = {
  jobType: "all", remote: "all", city: "", funding: "all", minPay: "",
  maxHours: "", hiringPeriod: "all", exclude: "", listedPay: false,
  keywords: "", minHours: "", busRoute: "all", sort: "relevance",
};

function applyFilterValues(values) {
  for (const [key, el] of Object.entries(filterEls)) {
    const value = values?.[key] ?? FILTER_DEFAULTS[key];
    if (el.type === "checkbox") el.checked = Boolean(value);
    else if (el.tagName !== "SELECT" || [...el.options].some((o) => o.value === String(value))) el.value = value;
  }
}

function saveFilters() {
  const values = {};
  for (const [key, el] of Object.entries(filterEls)) values[key] = el.type === "checkbox" ? el.checked : el.value;
  saveStore(STORE.filters, values);
}

let tracker = loadStore(STORE.tracker, {}); // job_id -> { id, title, department, url, status, updated }
let rejectedJobs = loadStore(STORE.rejected, []); // [{ id, title, department, reason, learn, ts }]
if (typeof tracker !== "object" || Array.isArray(tracker)) tracker = {};
if (!Array.isArray(rejectedJobs)) rejectedJobs = [];
applyFilterValues(loadStore(STORE.filters, {}));

const STATUSES = [
  ["saved", "Saved"],
  ["applied", "Applied"],
  ["interviewing", "Interviewing"],
  ["offer", "Offer"],
  ["not_selected", "Not selected"],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);

// `learn` reasons also steer the ranking away from similar jobs. The rest only hide
// the job (and, where it makes sense, tighten a filter), since the job itself is
// the right kind of work.
const REJECT_REASONS = [
  ["field", "Wrong kind of work", true],
  ["pay", "Pay is too low", false],
  ["hours", "Too many hours", false],
  ["location", "Wrong location", false],
  ["expired", "Looks expired or fake", false],
  ["other", "Just not interested", true],
];
const REJECT_LABEL = Object.fromEntries(REJECT_REASONS.map(([v, l]) => [v, l]));

const PAGE_SIZE = 20;

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
    error: "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700",
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
const MAX_RESUME_CHARS = 20000; // the model only reads the first ~1,000 characters anyway
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
// Subresource Integrity: the browser refuses these scripts if the CDN ever serves different bytes.
const SCRIPT_INTEGRITY = {
  [PDFJS_URL]: "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e",
  [MAMMOTH_URL]: "sha384-nFoSjZIoH3CCp8W639jJyQkuPHinJ2NHe7on1xvlUA7SuGfJAfvMldrsoAVm6ECz",
};

// { id, file, status: "parsing" | "ready" | "error", text, error, promise }
let resumeFiles = [];
let nextFileId = 0;

// Parser libraries are only downloaded the first time a file of that type is added.
const scriptCache = {};
function loadScript(src) {
  scriptCache[src] ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    if (SCRIPT_INTEGRITY[src]) {
      el.integrity = SCRIPT_INTEGRITY[src];
      el.crossOrigin = "anonymous";
    }
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
    <li class="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
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
  return parts.filter(Boolean).join("\n\n").slice(0, MAX_RESUME_CHARS);
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

const DAY_MS = 86400000;

function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function daysFromToday(date) {
  const now = new Date();
  return Math.round((date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);
}

const formatDate = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

function daysAgo(job) {
  const posted = parseIsoDate(job.posted_date);
  return posted ? -daysFromToday(posted) : null;
}

function relativeDays(n) {
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

// Short form for the sidebar card.
function postedShort(job) {
  const n = daysAgo(job);
  return n === null ? "" : n <= 0 ? "Posted today" : `${n}d ago`;
}

// Freshness signals for a posting: how old it is and whether a deadline is near.
// Postings past a deadline or well past 90 days never reach the client.
function trustTags(job) {
  const tags = [];
  const n = daysAgo(job);
  if (n !== null && n <= 7) tags.push(`<span class="tag tag-good">New</span>`);
  if (n !== null && n > 45) tags.push(`<span class="tag tag-warn">Posted ${n} days ago: confirm it's still open</span>`);
  const deadline = parseIsoDate(job.deadline);
  if (deadline) {
    const left = daysFromToday(deadline);
    tags.push(`<span class="tag ${left <= 7 ? "tag-warn" : ""}">Apply by ${formatDate(deadline)}${left <= 7 ? ` (${left <= 0 ? "today" : `${left}d left`})` : ""}</span>`);
  }
  return tags.join("");
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
  const meta = [locationText(job.on_campus), job.is_work_study === true ? "Work-Study" : "", postedShort(job)].filter(Boolean).join(" · ");
  const tracked = tracker[job.job_id];
  return `
    <li id="job-item-${index}" class="job-item" role="option" aria-selected="false" tabindex="-1" data-index="${index}">
      <span class="rank-dot mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-xs font-semibold">${index + 1}</span>
      <div class="min-w-0 flex-1">
        <p class="job-item-title">${escapeHtml(job.title)}</p>
        <p class="mt-0.5 truncate text-xs text-stone-600">${escapeHtml(job.department)}</p>
        ${meta ? `<p class="mt-0.5 text-xs text-stone-400">${escapeHtml(meta)}</p>` : ""}
        ${tracked ? `<p class="mt-1 flex items-center gap-1.5 text-xs font-medium text-stone-600"><span class="status-dot" data-status="${escapeHtml(tracked.status)}"></span>${escapeHtml(STATUS_LABEL[tracked.status] || "")}</p>` : ""}
      </div>
      ${pct === null ? "" : `<span class="${badgeClass(pct)} h-fit shrink-0 whitespace-nowrap rounded-sm px-2 py-0.5 text-[11px] font-semibold">${pct}%</span>`}
    </li>`;
}

// The dealbreakers the current search was run with, in plain words.
function activeFilterParts(query = currentQuery) {
  if (!query) return [];
  const parts = [];
  if (query.job_type === "on_campus") parts.push("on-campus");
  if (query.job_type === "off_campus") parts.push("off-campus");
  if (query.remote === "remote_only") parts.push("remote/hybrid");
  if (query.remote === "in_person_only") parts.push("in-person");
  if (query.city) parts.push(`in ${query.city}`);
  if (query.funding === "work_study") parts.push("work-study");
  if (query.funding === "non_work_study") parts.push("not work-study");
  if (query.min_pay !== null) parts.push(`$${query.min_pay}+/hr`);
  if (query.listed_pay_only) parts.push("pay listed");
  if (query.max_hours !== null) parts.push(`≤ ${query.max_hours} hrs/wk`);
  if (query.keywords?.length) parts.push(`mentions "${query.keywords.join('", "')}"`);
  if (query.min_hours !== null) parts.push(`≥ ${query.min_hours} hrs/wk`);
  if (query.bus_route === "on_route") parts.push("on a bus route");
  if (query.hiring_period !== "all") parts.push(filterEls.hiringPeriod.selectedOptions[0]?.textContent.toLowerCase() || query.hiring_period);
  if (query.exclude_keywords?.length) parts.push(`no "${query.exclude_keywords.join('", "')}"`);
  return parts;
}

function chips(list, cls) {
  return list.map((s) => `<span class="tag ${cls}">${escapeHtml(s)}</span>`).join("");
}

// "Why this was recommended": the similarity score plus the concrete skills behind it.
function renderWhy(job, pct) {
  // Browsing without a resume: there's nothing to compare, so list the skills and invite a resume.
  if (!currentQuery?.resume) {
    const skills = job.skills || [];
    return `
    <h3 class="mt-6 text-base font-semibold text-stone-900">Skills this job mentions</h3>
    <div class="mt-2 flex flex-wrap gap-2">${skills.length ? chips(skills, "tag-accent") : '<span class="text-xs text-stone-400">No specific skills listed.</span>'}</div>
    <p class="mt-3 text-sm text-stone-500">Add your resume above and search again to rank jobs by fit and see which of these skills you already have.</p>`;
  }
  const matched = job.matched_skills || [];
  const missing = job.missing_skills || [];
  const filters = activeFilterParts();
  const hasSkills = matched.length || missing.length;
  return `
    <h3 class="mt-6 text-base font-semibold text-stone-900">Why this was recommended</h3>
    ${pct === null ? "" : `
    <div class="mt-2">
      <div class="mb-1 flex justify-between text-xs text-stone-500"><span>Resume similarity</span><span>${pct}%</span></div>
      <div class="h-1.5 overflow-hidden rounded-sm bg-stone-100"><div class="score-bar h-full rounded-sm" style="width: ${pct}%"></div></div>
      <p class="mt-1.5 text-xs text-stone-500">How close your resume's wording is to this posting. It's a ranking signal, not a chance of getting hired.</p>
    </div>`}
    ${hasSkills ? `
    <div class="mt-4 space-y-3 text-sm">
      <div>
        <p class="mb-1.5 font-medium text-stone-700">Skills your resume covers (${matched.length})</p>
        <div class="flex flex-wrap gap-2">${matched.length ? chips(matched, "tag-good") : '<span class="text-xs text-stone-400">None of the posting\'s listed skills appear in your resume.</span>'}</div>
      </div>
      <div>
        <p class="mb-1.5 font-medium text-stone-700">Skills the posting asks for that your resume doesn't mention (${missing.length})</p>
        <div class="flex flex-wrap gap-2">${missing.length ? chips(missing, "tag-warn") : '<span class="text-xs text-stone-400">None. Your resume covers everything listed.</span>'}</div>
      </div>
      <p class="text-xs text-stone-400">Skills are matched by keyword. If you have one that's missing, add it to your resume; if you don't, that's a gap to weigh.</p>
    </div>` : `<p class="mt-3 text-sm text-stone-500">This posting doesn't list skills we can recognise, so the match rests on its overall wording.</p>`}
    <p class="mt-4 text-xs text-stone-500">${filters.length ? `Meets your dealbreakers: ${escapeHtml(filters.join(" · "))}.` : "No dealbreakers set."}</p>`;
}

function glanceRow(label, value) {
  return value ? `<div><dt class="text-xs text-stone-400">${label}</dt><dd class="text-sm text-stone-800">${value}</dd></div>` : "";
}

// Pay, hours and listing-freshness facts up front, so a match is actionable without more research.
function renderGlance(job) {
  const min = Number(job.pay_min);
  const max = Number(job.pay_max);
  const fmt = (n) => `$${n % 1 ? n.toFixed(2) : n}`;
  let pay = "";
  if (Number.isFinite(min)) {
    pay = `${Number.isFinite(max) && max > min ? `${fmt(min)}–${fmt(max)}` : fmt(min)}/hr`;
    if (job.pay_is_estimated) pay += ` <span class="text-xs text-amber-700">(not listed; estimated at MA minimum wage)</span>`;
  }
  const known = (v) => (v && v !== "Not Specified" ? escapeHtml(v) : "");
  const hours = known(job.hours_per_week);
  const posted = parseIsoDate(job.posted_date);
  const deadline = parseIsoDate(job.deadline);
  const checked = job.last_seen ? new Date(job.last_seen) : null;
  const n = daysAgo(job);
  return `
    <dl class="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-stone-200 bg-stone-50 p-4">
      ${glanceRow("Pay", pay)}
      ${glanceRow("Hours per week", hours ? (/hour|hr/i.test(hours) ? hours : `${hours} hrs`) : "")}
      ${glanceRow("Hiring period", known(job.hiring_period))}
      ${glanceRow("Location", [locationText(job.on_campus), known(job.city)].filter(Boolean).join(" · "))}
      ${glanceRow("Posted", posted ? `${formatDate(posted)} (${relativeDays(n)})` : '<span class="text-stone-400">Date unavailable</span>')}
      ${glanceRow("Application deadline", deadline ? formatDate(deadline) : '<span class="text-stone-400">None stated</span>')}
      ${glanceRow("Last verified on UMass board", checked && !Number.isNaN(+checked) ? formatDate(checked) : "")}
      ${glanceRow("Department", known(job.department))}
    </dl>`;
}

function trackerControls(job) {
  if (!job.job_id) return "";
  const entry = tracker[job.job_id];
  const options = STATUSES.map(([v, l]) => `<option value="${v}"${entry?.status === v ? " selected" : ""}>${l}</option>`).join("");
  const rejectOptions = REJECT_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  return `
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <label class="sr-only" for="track-select">Track this job</label>
      <select id="track-select" class="mini-select" data-track>
        <option value=""${entry ? " hidden" : " selected"} disabled>Track this job…</option>
        ${options}
        ${entry ? '<option value="__remove">Stop tracking</option>' : ""}
      </select>
      <label class="sr-only" for="reject-select">Mark as not a fit</label>
      <select id="reject-select" class="mini-select" data-reject>
        <option value="" selected disabled>Not a fit. Why?</option>
        ${rejectOptions}
      </select>
    </div>`;
}

// Detail pane: the full posting for one job.
function renderDetail(job) {
  const pct = toPercent(job);
  const postingHref = safeHref(job.url);
  const applyHref = safeHref(job.apply_url) || postingHref;
  const mailHref = safeHref(job.mailto_url, ["mailto:"]);
  const title = postingHref
    ? `<a href="${postingHref}" target="_blank" rel="noopener noreferrer" class="hover:underline">${escapeHtml(job.title)}</a>`
    : escapeHtml(job.title);
  const remoteTag = job.remote_friendly ? `<span class="tag">Remote / hybrid option</span>` : "";

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
          ${pct === null ? "" : `<span class="${badgeClass(pct)} shrink-0 whitespace-nowrap rounded-sm px-3 py-1 text-xs font-semibold" title="Semantic similarity between your resume and this posting">${pct}% similar</span>`}
        </div>
        ${applyHref || mailHref ? `
        <div class="card-actions mt-4 flex flex-wrap gap-2">
          ${applyHref ? `<a href="${applyHref}" target="_blank" rel="noopener noreferrer" class="btn-maroon rounded-sm px-5 py-2 text-sm font-semibold">Apply Now ↗</a>` : ""}
          ${mailHref ? `<a href="${mailHref}" class="rounded-sm border border-maroon bg-white px-5 py-2 text-sm font-semibold text-maroon hover:bg-stone-50">Email Contact</a>` : ""}
        </div>` : ""}
        ${trackerControls(job)}
      </div>

      <div class="px-4 py-5 sm:px-6">
        <div class="flex flex-wrap gap-2">
          ${trustTags(job)}
          ${categoryTag(job)}
          ${workStudyTag(job.is_work_study)}
          ${locationTag(job.on_campus)}
          ${remoteTag}
        </div>

        ${renderGlance(job)}
        ${renderWhy(job, pct)}

        <h3 class="mt-6 text-base font-semibold text-stone-900">About the job</h3>
        <p class="job-detail-desc mt-2 text-sm leading-relaxed text-stone-700">${escapeHtml(descriptionText(job)) || '<span class="text-stone-400">No description provided.</span>'}</p>
        <p class="mt-4 text-xs text-stone-400">Employer reviews, turnover and interview details aren't published for UMass student jobs, so none are shown. Contact the department if you have questions.</p>
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
  const num = (el) => (el.value === "" ? null : Number(el.value));
  return {
    job_type: filterEls.jobType.value,
    remote: filterEls.remote.value,
    city: filterEls.city.value.trim() || null,
    funding: filterEls.funding.value,
    min_pay: num(filterEls.minPay),
    listed_pay_only: filterEls.listedPay.checked,
    max_hours: num(filterEls.maxHours),
    hiring_period: filterEls.hiringPeriod.value,
    keywords: filterEls.keywords.value.split(",").map((w) => w.trim()).filter(Boolean),
    min_hours: num(filterEls.minHours),
    bus_route: filterEls.busRoute.value,
    sort: filterEls.sort.value,
    exclude_keywords: filterEls.exclude.value.split(",").map((w) => w.trim()).filter(Boolean),
    // Feedback loop: rejected jobs are hidden, and the "wrong kind of work" ones also re-rank results.
    rejected_job_ids: rejectedJobs.filter((r) => r.learn).slice(-200).map((r) => r.id),
    hidden_job_ids: rejectedJobs.filter((r) => !r.learn).slice(-200).map((r) => r.id),
  };
}

function hasActiveFilters() {
  return activeFilterParts(currentFilters()).length > 0 || rejectedJobs.length > 0;
}

const HIDDEN_LABELS = {
  not_a_fit: "marked not a fit",
  expired: "past their deadline",
  stale: "posted over 90 days ago",
  job_type: "by job type",
  funding: "by funding type",
  pay: "by pay",
  hours: "by hours",
  hiring_period: "by hiring period",
  remote: "by work mode",
  city: "by city",
  keyword: "by excluded keywords",
  no_keyword_match: "not matching your keywords",
  bus_route: "by bus route",
};

// Makes dealbreakers visible: what each hard filter (and each freshness check) removed.
function showFilterSummary(hiddenBy) {
  const parts = Object.entries(hiddenBy || {})
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${HIDDEN_LABELS[reason] || reason}`);
  filterSummaryEl.classList.toggle("hidden", parts.length === 0);
  filterSummaryEl.textContent = parts.length ? `Hidden: ${parts.join(", ")}.` : "";
}

// Matching runs in the browser (js/matcher.js): there is no API server.
function fetchPage(query, offset, signal) {
  return Matcher.page(query, offset, PAGE_SIZE, signal);
}

function errorMessage(err) {
  return escapeHtml(err.message);
}

function setLoadMoreLoading(loading) {
  loadingMore = loading;
  if (loading) loadMoreErrorEl.classList.add("hidden");
  loadMoreBtn.disabled = loading;
  loadMoreSpinner.classList.toggle("hidden", !loading);
  loadMoreLabel.textContent = loading ? "Loading…" : "Load More Jobs";
}

function updatePaginationUi() {
  loadMoreBtn.classList.toggle("hidden", !hasMore);
  const noun = currentQuery?.resume ? "matches" : "jobs";
  document.getElementById("results-title").textContent = currentQuery?.resume ? "Your matches" : "All open jobs";
  resultsMetaEl.textContent = jobs.length ? `Showing ${jobs.length} of ${totalMatches} ${noun}` : "";
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
  // No resume is fine: the matcher then lists every open job (newest first) with no match scores.
  const controller = (activeController = new AbortController());
  resetResults();
  const query = { resume, ...currentFilters() };
  showStatus(resume && !Matcher.modelLoaded
    ? "Loading the matching model (about 22 MB, only the first time)…"
    : "Finding your best campus matches…");
  renderSkeletons();

  try {
    const data = await fetchPage(query, 0, controller.signal);
    if (id !== searchId) return;
    resultsEl.innerHTML = "";
    currentQuery = query;
    showFilterSummary(data?.hidden_by);
    if (!data?.matches?.length) {
      resultsLayout.classList.add("hidden");
      showStatus(hasActiveFilters() ? "No jobs match these filters. Try loosening them." : "No matching jobs found.");
      return;
    }
    hideStatus();
    appendPage(data);
    observeSentinel(); // the observer may have fired during the skeleton phase
    // Bring the two panes to the top of the viewport, LinkedIn-style.
    if (!compactLayout.matches) resultsLayout.scrollIntoView({ block: "start", behavior: "smooth" });
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
    appendPage(data);
    observeSentinel(); // still near the bottom (tall screen / few rows)? fetch again
  } catch (err) {
    if (err.name === "AbortError" || id !== searchId) return;
    // Shown under the button (not just in the header) so a failed page is obvious; the button retries.
    loadMoreErrorEl.innerHTML = `Couldn't load more jobs: ${errorMessage(err)} Click the button to retry.`;
    loadMoreErrorEl.classList.remove("hidden");
  } finally {
    if (id === searchId) setLoadMoreLoading(false);
  }
}

// Infinite scroll: fetch the next page when the bottom of the list nears the
// visible area of the list pane. The button stays as a manual fallback.
const sentinel = document.getElementById("load-more-sentinel");
let sentinelObserver = null;
function observeSentinel() {
  sentinelObserver?.disconnect();
  // Wide layout: the list pane scrolls itself. Narrow layout: the page scrolls.
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    {
      root: compactLayout.matches ? null : document.getElementById("jobs-list-scroll"),
      rootMargin: "0px 0px 300px 0px",
    }
  );
  sentinelObserver.observe(sentinel);
}
compactLayout.addEventListener("change", observeSentinel);
observeSentinel();

/* ------------------------------------------------------------------------ *
 * Application tracker, "not a fit" feedback, privacy controls (all local)
 * ------------------------------------------------------------------------ */

let toastTimer = null;
function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.className = "fixed bottom-4 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-md bg-stone-900 px-4 py-3 text-sm text-white shadow-lg";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 6000);
}

function refreshJobViews(index) {
  const li = document.getElementById(`job-item-${index}`);
  if (li) {
    const selected = li.getAttribute("aria-selected");
    li.outerHTML = renderListItem(jobs[index], index);
    const fresh = document.getElementById(`job-item-${index}`);
    fresh.setAttribute("aria-selected", selected);
    fresh.setAttribute("tabindex", selected === "true" ? "0" : "-1");
  }
  if (index === selectedIndex) {
    const top = detailEl.scrollTop;
    detailEl.innerHTML = renderDetail(jobs[index]);
    detailEl.scrollTop = top;
    if (detailEl.classList.contains("is-open")) detailEl.querySelector("[data-close-detail]")?.focus({ preventScroll: true });
  }
}

function setTrackedStatus(job, status) {
  if (!job.job_id) return;
  if (status === "__remove") delete tracker[job.job_id];
  else {
    tracker[job.job_id] = {
      id: job.job_id, title: job.title, department: job.department,
      url: job.apply_url || job.url || "", status, updated: new Date().toISOString(),
    };
  }
  saveStore(STORE.tracker, tracker);
  renderTracker();
}

function renderTracker() {
  const entries = Object.values(tracker).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  trackerPanel.classList.toggle("hidden", entries.length === 0);
  trackerListEl.innerHTML = entries.map((e) => {
    const href = safeHref(e.url);
    const title = href
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="font-medium text-stone-900 hover:underline">${escapeHtml(e.title)}</a>`
      : `<span class="font-medium text-stone-900">${escapeHtml(e.title)}</span>`;
    const options = STATUSES.map(([v, l]) => `<option value="${v}"${e.status === v ? " selected" : ""}>${l}</option>`).join("");
    const updated = new Date(e.updated);
    return `
      <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <span class="status-dot" data-status="${escapeHtml(e.status)}"></span>
        <div class="min-w-0 flex-1 text-sm">
          <p class="truncate">${title}</p>
          <p class="truncate text-xs text-stone-500">${escapeHtml(e.department)}${Number.isNaN(+updated) ? "" : ` · updated ${formatDate(updated)}`}</p>
        </div>
        <select class="mini-select" data-tracker-status="${escapeHtml(e.id)}" aria-label="Status for ${escapeHtml(e.title)}">${options}</select>
        <button type="button" class="text-xs text-stone-500 hover:text-maroon" data-tracker-remove="${escapeHtml(e.id)}">Remove</button>
      </li>`;
  }).join("");
}

function csvCell(value) {
  const text = String(value ?? "");
  // Leading = + - @ would be read as a formula by spreadsheet apps.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportTrackerCsv() {
  const rows = [["Title", "Department", "Status", "Link", "Last updated"]];
  Object.values(tracker).forEach((e) => rows.push([e.title, e.department, STATUS_LABEL[e.status] || e.status, e.url, e.updated]));
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "umass-job-applications.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderRejected() {
  rejectedPanel.classList.toggle("hidden", rejectedJobs.length === 0);
  document.getElementById("rejected-count").textContent = rejectedJobs.length ? `(${rejectedJobs.length})` : "";
  rejectedListEl.innerHTML = [...rejectedJobs].reverse().map((r) => `
    <li class="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
      <div class="min-w-0 flex-1">
        <p class="truncate text-stone-800">${escapeHtml(r.title)}</p>
        <p class="truncate text-xs text-stone-500">${escapeHtml(r.department)} · ${escapeHtml(REJECT_LABEL[r.reason] || "Not a fit")}</p>
      </div>
      <button type="button" class="text-xs font-medium text-maroon hover:underline" data-restore="${escapeHtml(r.id)}">Restore</button>
    </li>`).join("");
}

// Turn a rejection reason into a hard filter when it says something about a preference,
// so the same kind of job doesn't come back. Returns a message describing the change.
function tightenFilter(job, reason) {
  const pick = (el, values, choose) => {
    const value = choose(values);
    if (value === undefined) return false;
    el.value = String(value);
    return true;
  };
  if (reason === "pay") {
    const top = Number(job.pay_max ?? job.pay_min);
    const options = [...filterEls.minPay.options].map((o) => Number(o.value)).filter((v) => v > 0);
    if (Number.isFinite(top) && pick(filterEls.minPay, options, (vs) => vs.find((v) => v > top))) {
      return `Minimum pay set to $${filterEls.minPay.value}+/hr.`;
    }
  } else if (reason === "hours") {
    const lowest = Number(String(job.hours_per_week || "").match(/\d+(?:\.\d+)?/)?.[0]);
    const options = [...filterEls.maxHours.options].map((o) => Number(o.value)).filter((v) => v > 0);
    if (Number.isFinite(lowest) && pick(filterEls.maxHours, options, (vs) => [...vs].reverse().find((v) => v < lowest))) {
      return `Max hours set to ${filterEls.maxHours.value}/week.`;
    }
  } else if (reason === "location" && job.on_campus !== undefined && job.on_campus !== null) {
    filterEls.jobType.value = job.on_campus ? "off_campus" : "on_campus";
    return `Showing ${job.on_campus ? "off-campus" : "on-campus"} jobs only.`;
  }
  return "";
}

function rejectJob(job, reason) {
  if (!job.job_id) return;
  const learn = REJECT_REASONS.find(([v]) => v === reason)?.[2] ?? false;
  rejectedJobs = rejectedJobs.filter((r) => r.id !== job.job_id);
  rejectedJobs.push({ id: job.job_id, title: job.title, department: job.department, reason, learn, ts: Date.now() });
  saveStore(STORE.rejected, rejectedJobs);

  const change = tightenFilter(job, reason);
  if (change) saveFilters();
  renderRejected();
  toast(["Got it. Hidden, and results re-ranked.", change, learn ? "Similar jobs will rank lower." : ""].filter(Boolean).join(" "));
  findMatches();
}

function restoreJob(id) {
  rejectedJobs = rejectedJobs.filter((r) => r.id !== id);
  saveStore(STORE.rejected, rejectedJobs);
  renderRejected();
  if (hasSearched) findMatches();
}

function resetFilters() {
  applyFilterValues({});
  saveFilters();
  if (hasSearched) findMatches();
}

function eraseLocalData() {
  if (!window.confirm("Clear the filters, application tracker and \"not a fit\" choices this site saved on your device? Your resume isn't saved, and nothing else in your browser is touched. This can't be undone.")) return;
  clearStores();
  tracker = {};
  rejectedJobs = [];
  applyFilterValues({});
  renderTracker();
  renderRejected();
  if (hasSearched) findMatches();
  toast("Your saved filters, tracker and feedback were cleared.");
}

renderTracker();
renderRejected();

/* ------------------------------------------------------------------------ *
 * Event wiring
 * ------------------------------------------------------------------------ */

button.addEventListener("click", findMatches);
loadMoreBtn.addEventListener("click", loadMore);
// Start downloading the model as soon as someone begins a resume, so the search itself is quick.
const warmModel = () => Matcher.loadModel().catch(() => {}); // a failure resurfaces on search
resumeEl.addEventListener("input", warmModel, { once: true });
fileInput.addEventListener("change", warmModel, { once: true });
dropzone.addEventListener("drop", warmModel, { once: true });

resumeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) findMatches();
});

// Filters re-run the search that's on screen; before the first search they
// just wait to be sent with it.
Object.values(filterEls).forEach((el) =>
  el.addEventListener("change", () => {
    saveFilters();
    if (hasSearched) findMatches();
  })
);
document.getElementById("reset-filters").addEventListener("click", resetFilters);
document.getElementById("clear-data").addEventListener("click", eraseLocalData);
document.getElementById("tracker-export").addEventListener("click", exportTrackerCsv);

// Delegated: the detail pane is re-rendered, so its selects can't hold listeners.
detailEl.addEventListener("change", (e) => {
  const job = jobs[selectedIndex];
  if (!job) return;
  if (e.target.matches("[data-track]")) {
    setTrackedStatus(job, e.target.value);
    refreshJobViews(selectedIndex);
  } else if (e.target.matches("[data-reject]")) {
    rejectJob(job, e.target.value);
  }
});

trackerListEl.addEventListener("change", (e) => {
  const id = e.target.dataset.trackerStatus;
  if (!id || !tracker[id]) return;
  tracker[id] = { ...tracker[id], status: e.target.value, updated: new Date().toISOString() };
  saveStore(STORE.tracker, tracker);
  renderTracker();
  jobs.forEach((job, i) => job.job_id === id && refreshJobViews(i));
});
trackerListEl.addEventListener("click", (e) => {
  const id = e.target.closest("[data-tracker-remove]")?.dataset.trackerRemove;
  if (!id) return;
  delete tracker[id];
  saveStore(STORE.tracker, tracker);
  renderTracker();
  jobs.forEach((job, i) => job.job_id === id && refreshJobViews(i));
});
rejectedListEl.addEventListener("click", (e) => {
  const id = e.target.closest("[data-restore]")?.dataset.restore;
  if (id) restoreJob(id);
});

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

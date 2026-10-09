/* Runs the job matching in the browser, so the site needs no server of its own.
 * A port of backend/main.py: embed the resume with the same MiniLM model the scraper
 * uses, ask Supabase for the nearest jobs, then filter, sort and page in JS.
 * The publishable key only reads (Row Level Security); writes need the secret key,
 * which only the scraper has. */

const SUPABASE_URL = "https://fgocjegvvpkbgptigqzc.supabase.co";
const SUPABASE_KEY = "sb_publishable_pIN1VXiiXFUPRQ96k09I5A_6pv8agaU"; // publishable key: safe to ship, read-only

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"; // ONNX export of the scraper's all-MiniLM-L6-v2
const MODEL_MAX_TOKENS = 256; // what sentence-transformers reads; the tokenizer alone would allow 512

const CANDIDATE_POOL = 1000; // keep >= rows in umass_jobs so every job is reachable
const MAX_POSTING_AGE_DAYS = 90;
const REJECT_WEIGHT = 0.6; // how hard "not a fit" jobs push the ranking away from similar ones
const REQUEST_TIMEOUT_MS = 15000;

const HIRING_PERIODS = {
  fall_only: "fall semester only",
  spring_only: "spring semester only",
  summer: "summer",
  academic_year: "academic year",
  entire_year: "entire year",
};

const BROWSE_COLUMNS =
  "job_id,title,department,description,short_description,skills,is_work_study,on_campus," +
  "url,apply_url,contact_email,mailto_url,pay_min,pay_max,pay_is_estimated,hours_per_week," +
  "hiring_period,city,posted_date,deadline,remote_friendly,on_bus_route,last_seen";

// Same catalogue as backend/skills.py (the scraper tags jobs with it; this tags the resume).
const SKILL_REGEXES = [
  ["Python", /\bpython\b/i],
  ["Java", /\bjava\b(?!script)/i],
  ["JavaScript", /\bjavascript\b/i],
  ["HTML/CSS", /\bhtml\b|\bcss\b/i],
  ["SQL", /\bsql\b/i],
  ["Excel", /\bexcel\b|spreadsheet/i],
  ["Microsoft Office", /microsoft office|\bms office\b|\bword\b.*\bpowerpoint\b/i],
  ["Google Workspace", /google (?:docs|sheets|drive|workspace)/i],
  ["Adobe Creative Suite", /\badobe\b|photoshop|illustrator|indesign|premiere/i],
  ["Canva", /\bcanva\b/i],
  ["Graphic Design", /graphic|design(?:ing)? (?:flyers|posters|graphics)/i],
  ["Video Editing", /video (?:editing|production)/i],
  ["Social Media", /social media|instagram|tiktok/i],
  ["Web Development", /wordpress|web ?site (?:updates|maintenance)|web development/i],
  ["IT Support", /help ?desk|troubleshoot|tech(?:nical)? support|it support/i],
  ["Data Entry", /data entry/i],
  ["Research", /\bresearch\b/i],
  ["Customer Service", /customer service|greet|front[- ]of[- ]house|hospitality/i],
  ["Cash Handling", /\bcash\b|register|point of sale|\bpos\b|payments/i],
  ["Food Prep", /food prep|prep cook|line cook|kitchen/i],
  ["Food Service", /\bserver?s?\b|food service|dining|wait staff/i],
  ["Childcare", /child ?care|babysit|nanny|toddler|\bkids\b|children/i],
  ["Tutoring", /\btutor/i],
  ["Instruction", /\binstruct|\bteach|lesson plan/i],
  ["CPR/First Aid", /\bcpr\b|first aid|\baed\b/i],
  ["Lifeguard Certification", /lifeguard/i],
  ["Driving", /driver'?s license|driving record|own transportation|\bdrive\b/i],
  ["Lab Skills", /laborator|\blab\b|beaker|lab safety/i],
  ["Cleaning", /\bclean(?:ing|s|ed)?\b(?!\s+driving)|sanitiz|dish/i],
  ["Physical Labor", /lifting|landscap|yard ?work|gardening|garden (?:beds|work|tasks)|hauling|digging/i],
  ["Event Support", /\bevents?\b/i],
  ["Office Admin", /clerical|filing|reception|front desk|office work/i],
  ["Scheduling", /(?:manag|coordinat|maintain|handl)\w*\s+(?:the\s+|a\s+)?schedul|\bschedul\w*\s+(?:appointments|meetings|posts|content|events)/i],
  ["Bilingual", /bilingual|spanish|mandarin|portuguese/i],
];

const extractSkills = (text) => SKILL_REGEXES.filter(([, re]) => re.test(text)).map(([name]) => name);

/* ---------------------------------------------------------------- model --- */

let extractorPromise = null;
const embedCache = new Map(); // "Load more" and re-filtering reuse the same resume

const Matcher = {
  modelLoaded: false,

  // Downloads the model (~23 MB, then cached by the browser). Safe to call repeatedly.
  loadModel() {
    extractorPromise ??= import(TRANSFORMERS_URL)
      .then(async ({ pipeline, env }) => {
        env.allowLocalModels = false;
        // 8-bit weights: 22 MB instead of 97 MB. Same top match as the scraper's fp32 model in
        // testing, 9-10 of the same top 10, and similarity scores within ~0.05.
        const extractor = await pipeline("feature-extraction", MODEL_NAME, { dtype: "q8" });
        extractor.tokenizer.model_max_length = MODEL_MAX_TOKENS;
        Matcher.modelLoaded = true;
        return extractor;
      })
      .catch((err) => {
        extractorPromise = null; // let the next search retry
        throw new Error(`Couldn't load the matching model (${err.message}). Check your connection and try again.`);
      });
    return extractorPromise;
  },

  async embed(text) {
    if (!embedCache.has(text)) {
      const extractor = await Matcher.loadModel();
      const output = await extractor(text, { pooling: "mean", normalize: true });
      embedCache.set(text, Array.from(output.data));
      if (embedCache.size > 64) embedCache.delete(embedCache.keys().next().value);
    }
    return embedCache.get(text);
  },
};

/* ------------------------------------------------------------- supabase --- */

async function supabase(path, { body, signal } = {}) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (err.name === "AbortError" && signal?.aborted) throw err;
    throw new Error("The job database is unavailable. Please try again.");
  }
  if (!res.ok) throw new Error("The job database is unavailable. Please try again.");
  return res.json();
}

const queryMatches = (embedding, signal) =>
  supabase("rpc/match_umass_jobs", { body: { query_embedding: embedding, match_count: CANDIDATE_POOL }, signal });

const browseJobs = (signal) => supabase(`umass_jobs?select=${BROWSE_COLUMNS}&limit=${CANDIDATE_POOL}`, { signal });

const centroidCache = new Map();
async function rejectedCentroid(jobIds, signal) {
  const key = [...new Set(jobIds)].sort().join(",");
  if (!centroidCache.has(key)) {
    const list = key.split(",").map((id) => `"${id.replace(/"/g, "")}"`).join(",");
    const rows = await supabase(`umass_jobs?select=embedding&job_id=in.(${encodeURIComponent(list)})`, { signal });
    const vectors = rows
      .filter((r) => r.embedding)
      .map((r) => (typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding));
    centroidCache.set(key, vectors.length ? vectors[0].map((_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length) : null);
  }
  return centroidCache.get(key);
}

// Rank jobs for a resume, steering away from jobs the user rejected (Rocchio-style feedback).
// Ordering uses `resume - w * mean(rejected)`; the displayed score stays the plain similarity.
async function rankMatches(embedding, rejectedIds, signal) {
  const scored = await queryMatches(embedding, signal);
  if (!rejectedIds.length) return scored;
  let centroid;
  try {
    centroid = await rejectedCentroid(rejectedIds, signal);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    console.warn("Ranking without feedback:", err);
    return scored;
  }
  if (!centroid) return scored;

  const adjusted = embedding.map((x, i) => x - REJECT_WEIGHT * centroid[i]);
  const norm = Math.hypot(...adjusted) || 1;
  const reranked = await queryMatches(adjusted.map((x) => x / norm), signal);
  const order = new Map(reranked.map((row, rank) => [row.job_id, rank]));
  return [...scored].sort((a, b) => (order.get(a.job_id) ?? order.size) - (order.get(b.job_id) ?? order.size));
}

/* -------------------------------------------------------------- filters --- */

function hoursRange(text) {
  const numbers = (String(text || "").match(/\d+(?:\.\d+)?/g) || []).map(Number);
  return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
}

const isoDay = (value) => (value ? String(value).slice(0, 10) : null);
const dayNumber = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Why a job is hidden, or null to show it. Filters are hard: a job that doesn't say
// (unknown pay, hours, city...) is hidden too rather than given the benefit of the doubt.
function rejectReason(row, q, today, hiddenIds) {
  if (hiddenIds.has(row.job_id)) return "not_a_fit";

  const deadline = isoDay(row.deadline);
  if (deadline && deadline < today) return "expired";
  const posted = isoDay(row.posted_date);
  if (posted && dayNumber(today) - dayNumber(posted) > MAX_POSTING_AGE_DAYS) return "stale";

  if (q.job_type === "on_campus" && row.on_campus !== true) return "job_type";
  if (q.job_type === "off_campus" && row.on_campus !== false) return "job_type";
  if (q.funding === "work_study" && row.is_work_study !== true) return "funding";
  if (q.funding === "non_work_study" && row.is_work_study !== false) return "funding";

  if (q.min_pay != null || q.listed_pay_only) {
    if (q.listed_pay_only && row.pay_is_estimated !== false) return "pay"; // stored pay is only an estimate
    // A job qualifies when the top of its pay range reaches the requested rate.
    const top = row.pay_max ?? row.pay_min;
    if (q.min_pay != null && (top == null || Number(top) < q.min_pay)) return "pay";
  }

  if (q.max_hours != null) {
    const hours = hoursRange(row.hours_per_week);
    if (!hours || hours[0] > q.max_hours) return "hours"; // the job's minimum must fit
  }
  if (q.min_hours != null) {
    const hours = hoursRange(row.hours_per_week);
    if (!hours || hours[1] < q.min_hours) return "hours"; // the job must offer at least this many
  }

  if (q.bus_route === "on_route" && row.on_bus_route !== true) return "bus_route";

  if (q.hiring_period && q.hiring_period !== "all") {
    if (!String(row.hiring_period || "").toLowerCase().includes(HIRING_PERIODS[q.hiring_period])) return "hiring_period";
  }

  if (q.remote === "remote_only" && !row.remote_friendly) return "remote";
  if (q.remote === "in_person_only" && row.remote_friendly) return "remote";

  if (q.city && !String(row.city || "").toLowerCase().includes(q.city.toLowerCase())) return "city";

  if (q.keywords.length || q.exclude_keywords.length) {
    const haystack = ["title", "department", "description"].map((k) => String(row[k] ?? "")).join(" ").toLowerCase();
    if (q.exclude_keywords.some((w) => haystack.includes(w))) return "keyword";
    if (!q.keywords.every((w) => haystack.includes(w))) return "no_keyword_match";
  }
  return null;
}

// "relevance" keeps the similarity order rankMatches produced. Array.sort is stable.
function sortRows(rows, sort) {
  const by = (key, desc = false) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (desc ? -1 : 1));
  if (sort === "newest") return by((r) => String(r.posted_date ?? ""), true);
  if (sort === "pay_high") return by((r) => Number(r.pay_max ?? r.pay_min ?? 0), true);
  if (sort === "hours_low") return by((r) => (hoursRange(r.hours_per_week) || [1e9])[0]);
  return rows;
}

/* ---------------------------------------------------------------- search --- */

const cleanWords = (words) => words.map((w) => w.trim().toLowerCase().slice(0, 40)).filter(Boolean);

// Every job that survives the filters, in display order, plus what each filter removed.
async function runMatch(query, signal) {
  const resume = (query.resume || "").trim();
  const q = {
    ...query,
    sort: !resume && query.sort === "relevance" ? "newest" : query.sort, // nothing to rank by similarity
    keywords: cleanWords(query.keywords || []),
    exclude_keywords: cleanWords(query.exclude_keywords || []),
    city: (query.city || "").trim() || null,
  };
  const rejectedIds = (query.rejected_job_ids || []).map((id) => id.slice(0, 40));
  const hiddenIds = new Set([...rejectedIds, ...(query.hidden_job_ids || []).map((id) => id.slice(0, 40))]);

  const rows = resume ? await rankMatches(await Matcher.embed(resume), rejectedIds, signal) : await browseJobs(signal);

  const today = todayIso();
  const filtered = [];
  const hiddenBy = {};
  for (const row of rows) {
    const reason = rejectReason(row, q, today, hiddenIds);
    if (reason) hiddenBy[reason] = (hiddenBy[reason] || 0) + 1;
    else filtered.push(row);
  }

  const resumeSkills = new Set(extractSkills(resume));
  const matches = sortRows(filtered, q.sort).map((row) => {
    const jobSkills = row.skills || [];
    return {
      ...row,
      matched_skills: jobSkills.filter((s) => resumeSkills.has(s)),
      missing_skills: resume ? jobSkills.filter((s) => !resumeSkills.has(s)) : [],
      search_score: row.search_score != null ? Math.round(row.search_score * 1e4) / 1e4 : null,
    };
  });
  return { matches, hiddenBy };
}

// One search runs once; "Load more" pages through the cached result.
let lastResult = null; // { query, promise }

Matcher.page = async function (query, offset, limit, signal) {
  if (lastResult?.query !== query) lastResult = { query, promise: runMatch(query, signal) };
  let result;
  try {
    result = await lastResult.promise;
  } catch (err) {
    if (lastResult?.query === query) lastResult = null; // retry from scratch next time
    throw err;
  }
  const matches = result.matches.slice(offset, offset + limit);
  return {
    matches,
    offset,
    total: result.matches.length,
    has_more: offset + matches.length < result.matches.length,
    hidden_by: result.hiddenBy,
  };
};

const NUTRIENTS = ["calories", "protein", "fat", "fiber", "carbs", "sodium"];
const DEFAULT_GOALS = {
  calories: [2000, "max", "critical"], protein: [150, "min", "high"], fiber: [30, "min", "normal"],
  sodium: [2300, "max", "high"], fat: ["", "none", "normal"], carbs: ["", "none", "normal"],
};
const $ = (s) => document.querySelector(s);
const fmt = (v) => (Math.round(v * 10) / 10).toString();
let goTos = [];

/* ---------- foods table ---------- */
function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

function foodNames() {
  return new Set([...document.querySelectorAll("#foods .name")].map((t) => t.value.trim()));
}

function refreshTable() {
  const present = foodNames();
  document.querySelectorAll("#gotolist button").forEach((b) => {
    const isAdded = present.has(b.dataset.name);
    b.classList.toggle("added", isAdded);
    b.title = isAdded ? "Click again to remove" : "";
    b.textContent = isAdded ? "Added ✓" : "Add";
  });
}

// v = [name, calories, protein, fat, fiber, carbs, sodium, serving, max]
function addRow(v = [], record = true) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td><div class="namecell"><textarea class="name" rows="1" placeholder="Food name"></textarea>` +
    `<button title="Remove">×</button></div></td>` +
    `<td><input data-f="serving_size" placeholder="e.g. 1 cup"></td>` +
    `<td><input type="number" min="0" step="any" data-f="eaten" value="0"></td>` +
    `<td><input type="number" min="-1" step="any" data-f="max_servings" placeholder="no limit"></td>` +
    `<td class="sug">–</td>` +
    NUTRIENTS.map((f) => `<td><input type="number" min="0" step="any" data-f="${f}"></td>`).join("");
  const name = tr.querySelector(".name");
  name.value = v[0] || "";
  name.addEventListener("input", () => { autosize(name); refreshTable(); });
  NUTRIENTS.forEach((n, i) => (tr.querySelector(`[data-f=${n}]`).value = v[i + 1] ?? ""));
  tr.querySelector("[data-f=serving_size]").value = v[7] || "";
  // Manual rows start at 4; a go-to with no cap (null) leaves it blank = no limit.
  tr.querySelector("[data-f=max_servings]").value = v.length > 8 ? (v[8] ?? "") : 4;
  tr.querySelector("button").onclick = () => { tr.remove(); refreshTable(); commit(); };
  $("#foodbody").appendChild(tr);
  autosize(name);
  refreshTable();
  if (record) commit();
}

/* ---------- go-to list ---------- */
function renderGoTos() {
  const box = $("#gotolist");
  box.innerHTML = "";
  goTos.forEach((f) => {
    const row = document.createElement("div");
    row.className = "goto";
    const info = document.createElement("div");
    info.className = "info";
    const title = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = f.name;
    title.append(b, f.serving_size ? ` (${f.serving_size})` : "");
    const macros = document.createElement("div");
    macros.className = "macros";
    macros.textContent = `${fmt(f.calories)} cal, ${fmt(f.protein)} g protein, ${fmt(f.carbs)} g carbs, ` +
      `${fmt(f.fat)} g fat, ${fmt(f.fiber)} g fiber, ${fmt(f.sodium)} mg sodium`;
    info.append(title, macros);
    const btn = document.createElement("button");
    btn.dataset.name = f.name;
    btn.textContent = "Add";
    btn.onclick = () => {
      const existing = [...document.querySelectorAll("#foods .name")].find((t) => t.value.trim() === f.name);
      if (existing) { existing.closest("tr").remove(); refreshTable(); commit(); }
      else addRow([f.name, ...NUTRIENTS.map((n) => f[n]), f.serving_size, f.max_servings]);
    };
    row.append(info, btn);
    box.appendChild(row);
  });
  refreshTable();
}

async function loadGoTos() {
  try {
    const res = await fetch("static/gotos.json");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    goTos = data.foods;
    renderGoTos();
  } catch (e) {
    const box = $("#gotolist");
    box.innerHTML = "";
    const d = document.createElement("div");
    d.className = "goto err";
    d.textContent = "Could not load go-tos: " + e.message;
    box.appendChild(d);
  }
}

/* ---------- goal rows (top of the foods table) ---------- */
function buildGoals() {
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`).join("");
  const KINDS = [["none", "off"], ["min", "min"], ["max", "max"], ["exact", "exact"]];
  const PRIS = [["low", "low"], ["normal", "normal"], ["high", "high"], ["critical", "critical"]];
  const row = (label, cell) =>
    `<tr><td>${label}</td><td></td><td></td><td></td><td></td>${NUTRIENTS.map((n) => `<td>${cell(n, ...DEFAULT_GOALS[n])}</td>`).join("")}</tr>`;
  $("#goalrows").innerHTML =
    row("Goal", (n, val) => `<input type="number" min="0" step="any" class="gval" data-n="${n}" value="${val}">`) +
    row("Type", (n, v, kind) => `<select class="gkind" data-n="${n}">${opts(KINDS, kind)}</select>`) +
    row("Priority", (n, v, k, pri) => `<select class="gpri" data-n="${n}">${opts(PRIS, pri)}</select>`);
}

/* ---------- collapsible columns ---------- */
// Hidden columns are tracked in table.dataset.hidden ("3 5"); the CSS below does the
// collapsing, so rows added later pick it up automatically.
(function setupCollapse() {
  const css = [];
  for (let n = 1; n <= 14; n++) {
    const sel = (t) => `table[data-hidden~="${n}"] ${t}:nth-child(${n})`;
    css.push(`${sel("th")}, ${sel("td")} { width: 14px; min-width: 0; max-width: 14px; padding: 0; overflow: hidden;
      font-size: 0; color: transparent; cursor: pointer;
      background: repeating-linear-gradient(45deg, var(--color-hover-bg), var(--color-hover-bg) 4px, var(--color-panel) 4px, var(--color-panel) 8px); }
    ${sel("td")} > * { display: none; }
    ${sel("th")}::after { content: "▸"; font-size: 12px; color: var(--color-text-dim); }`);
  }
  $("#collapse-css").textContent = css.join("\n");

  document.querySelectorAll("#foods").forEach((table) => {
    const hidden = () => new Set((table.dataset.hidden || "").split(" ").filter(Boolean));
    const cellOf = (el) => {
      const cell = el.closest("td, th");
      return cell && table.contains(cell) ? cell : null;
    };
    const label = (idx) => {
      const th = table.querySelector(`thead th:nth-child(${idx})`);
      return th.dataset.label || th.textContent.trim();
    };

    // Custom tooltip: appears only after the cursor rests on a cell for 0.3 s.
    const tip = $("#tip");
    let timer = null, current = null, pos = { x: 0, y: 0 };
    const place = () => {
      tip.style.left = Math.min(pos.x + 12, window.innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = pos.y + 18 + "px";
    };
    const hideTip = () => {
      clearTimeout(timer);
      timer = null;
      current = null;
      tip.style.display = "none";
    };

    table.addEventListener("click", (e) => {
      hideTip();
      const cell = cellOf(e.target);
      if (!cell) return;
      const idx = String(cell.cellIndex + 1);
      const h = hidden();
      if (h.has(idx)) h.delete(idx);
      else if (cell.tagName === "TH") h.add(idx); // only headers collapse; collapsed strips expand
      else return;
      table.dataset.hidden = [...h].join(" ");
    });

    table.addEventListener("mouseover", (e) => {
      const cell = cellOf(e.target);
      if (cell === current) return; // still inside the same cell
      hideTip();
      if (!cell) return;
      const idx = cell.cellIndex + 1;
      const text = hidden().has(String(idx))
        ? `${label(idx)} (click to show)`
        : cell.tagName === "TH" ? `Click to collapse ${label(idx)}` : "";
      if (!text) return;
      current = cell;
      pos = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        tip.textContent = text;
        tip.style.display = "block";
        place();
      }, 600);
    });
    table.addEventListener("mousemove", (e) => {
      pos = { x: e.clientX, y: e.clientY };
      if (tip.style.display === "block") place();
    });
    table.addEventListener("mouseleave", hideTip);
  });

  $("#showall").onclick = () => document.querySelectorAll("#foods").forEach((t) => (t.dataset.hidden = ""));
})();

/* ---------- undo / redo ---------- */
// Snapshots of every input in both tables. commit() records a change; Ctrl/Cmd+Z steps back.
function snapshot() {
  return JSON.stringify({
    foods: [...document.querySelectorAll("#foodbody tr")].map((tr) => ({
      name: tr.querySelector(".name").value,
      f: Object.fromEntries([...tr.querySelectorAll("input[data-f]")].map((i) => [i.dataset.f, i.value])),
    })),
    goals: NUTRIENTS.map((n) => ["gval", "gkind", "gpri"].map((c) => $(`.${c}[data-n=${n}]`).value)),
  });
}

function restore(snap) {
  const s = JSON.parse(snap);
  $("#foodbody").innerHTML = "";
  s.foods.forEach((r) => {
    addRow([], false);
    const tr = $("#foodbody").lastElementChild;
    const name = tr.querySelector(".name");
    name.value = r.name;
    autosize(name);
    tr.querySelectorAll("input[data-f]").forEach((i) => (i.value = r.f[i.dataset.f]));
  });
  NUTRIENTS.forEach((n, i) => ["gval", "gkind", "gpri"].forEach((c, k) => ($(`.${c}[data-n=${n}]`).value = s.goals[i][k])));
  refreshTable();
}

const undoStack = [], redoStack = [];
let current = null;
const MAX_HISTORY = 200;

function commit() {
  const now = snapshot();
  if (now === current) return;
  undoStack.push(current);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  current = now;
}

function undo() {
  if (snapshot() !== current) return restore(current); // revert an uncommitted edit first
  if (!undoStack.length) return;
  redoStack.push(current);
  current = undoStack.pop();
  restore(current);
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(current);
  current = redoStack.pop();
  restore(current);
}

document.addEventListener("change", (e) => { if (e.target.closest("#foods")) commit(); });
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
});

/* ---------- sorting ---------- */
const SORTS = {
  az: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  za: (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }),
  cal_per_protein: (a, b) => a.cal_per_protein - b.cal_per_protein,
  protein_per_cal: (a, b) => b.protein_per_cal - a.protein_per_cal,
};
function sortFoods(key) {
  if (!key) return;
  const num = (tr, f) => parseFloat(tr.querySelector(`[data-f=${f}]`).value);
  const items = [...$("#foodbody").children].map((tr) => {
    const cal = num(tr, "calories"), pro = num(tr, "protein");
    return {
      tr, name: tr.querySelector(".name").value.trim(), v: NUTRIENTS.includes(key) ? num(tr, key) : NaN,
      cal_per_protein: pro > 0 && !isNaN(cal) ? cal / pro : Infinity,
      protein_per_cal: cal > 0 && !isNaN(pro) ? pro / cal : -Infinity,
    };
  });
  const cmp = SORTS[key] || ((a, b) => (isNaN(b.v) ? -Infinity : b.v) - (isNaN(a.v) ? -Infinity : a.v));
  items.sort((a, b) => (!a.name - !b.name) || cmp(a, b)); // unnamed rows last
  items.forEach((x) => $("#foodbody").appendChild(x.tr));
  commit();
}

/* ---------- calculate ---------- */
function payload() {
  const foods = [...document.querySelectorAll("#foodbody tr")].map((tr) => {
    const o = { name: tr.querySelector(".name").value };
    tr.querySelectorAll("input[data-f]").forEach((i) => (o[i.dataset.f] = i.value));
    return o;
  });
  const goals = NUTRIENTS.map((n) => ({
    nutrient: n, value: $(`.gval[data-n=${n}]`).value,
    kind: $(`.gkind[data-n=${n}]`).value, priority: $(`.gpri[data-n=${n}]`).value,
  }));
  return { foods, goals };
}

function setFoot(id, label, vals) {
  const tds = $(id).children;
  tds[0].textContent = label;
  NUTRIENTS.forEach((n, i) => (tds[i + 5].textContent = vals ? fmt(vals[n]) : ""));
}

async function calculate() {
  const msg = $("#msg");
  msg.textContent = "";
  let data;
  try {
    data = await MacroSolver.calculate(payload());
  } catch (e) {
    const span = document.createElement("span");
    span.className = "err";
    span.textContent = e.message;
    msg.appendChild(span);
    return;
  }
  const s = data.suggestion;
  setFoot("#logged", "Logged total", data.logged_total);
  setFoot("#plan", "Total with suggestions", s ? s.total : null);

  document.querySelectorAll("#foodbody tr").forEach((tr) => {
    const name = tr.querySelector(".name").value.trim();
    tr.querySelector(".sug").textContent = !name ? "" : s ? (s.servings[name] ?? 0) : "–";
  });

  const stCells = $("#status").children;
  NUTRIENTS.forEach((n, i) => {
    const st = s && s.statuses.find((x) => x.nutrient === n);
    const cell = stCells[i + 5];
    cell.className = st ? (st.met ? "met" : "unmet") : "";
    cell.textContent = st ? (st.met ? "met" : "not met") : "–";
  });

  if (!s) {
    const w = document.createElement("span");
    w.className = "warn";
    w.textContent = "Add at least one food and one goal to get suggestions.";
    msg.appendChild(w);
  } else {
    s.warnings.forEach((text) => {
      const d = document.createElement("div");
      d.className = "warn";
      d.textContent = text;
      msg.appendChild(d);
    });
  }
}

$("#gototoggle").onclick = () => {
  const closed = $("#gotowrap").classList.toggle("closed");
  $("#gototoggle").classList.toggle("closed", closed);
  $("#gototoggle").setAttribute("aria-expanded", String(!closed));
};

buildGoals();
refreshTable();
current = snapshot();
loadGoTos();
$("#add").onclick = () => addRow();
$("#calc").onclick = calculate;
$("#sort").onchange = (e) => sortFoods(e.target.value);

// theme toggle (shares the "portfolio-theme" key with aryamitra.me)
$("#themeToggle").onclick = () => {
  const dark = document.documentElement.getAttribute("data-theme") !== "dark";
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  $("#themeToggle").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  try { localStorage.setItem("portfolio-theme", dark ? "dark" : "light"); } catch (e) {}
};

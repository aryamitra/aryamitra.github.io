/* Browser port of macro_calculator (models.py, solver.py, api.py).
 *
 * Same tiered (lexicographic) mixed-integer program as the Python version, solved with HiGHS
 * (the solver scipy.optimize.milp uses) compiled to WebAssembly. If you change the filters or
 * priorities in solver.py, change them here too.
 *
 *   MacroSolver.calculate(payload)  ->  Promise of the same JSON /api/calculate used to return
 */
(function (root) {
  "use strict";

  const NUTRIENTS = ["calories", "protein", "fat", "fiber", "carbs", "sodium"];
  const PRIORITY = { LOW: 1, NORMAL: 10, HIGH: 100, CRITICAL: 1000 };
  const KINDS = ["exact", "min", "max"];
  const EPS = 1e-9;

  /* ---------- api.py ---------- */
  function num(value, label, dflt = 0) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
      if (dflt === null) throw new Error(`${label} is required`);
      return dflt;
    }
    const n = typeof value === "string" ? Number(value.trim()) : Number(value);
    if (typeof value === "boolean" || Number.isNaN(n)) throw new Error(`${label} must be a number, got ${JSON.stringify(value)}`);
    return n;
  }

  function maxServings(row, name) {
    const raw = row.max_servings;
    if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return Infinity;
    const v = num(raw, `${name} max servings`);
    return v === -1 ? Infinity : v;
  }

  function checkAmount(label, value, positive = false) {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite, got ${value}`);
    if (value < 0 || (positive && value === 0)) throw new Error(`${label} must be ${positive ? "> 0" : ">= 0"}, got ${value}`);
    return value;
  }

  function makeFood(name, row) {
    const food = { name, serving_size: String(row.serving_size ?? "").trim() };
    for (const n of NUTRIENTS) food[n] = checkAmount(`${name}.${n}`, num(row[n], `${name} ${n}`));
    const ms = maxServings(row, name);
    food.max_servings = ms === Infinity ? ms : checkAmount(`${name}.max_servings`, ms, true);
    return food;
  }

  const sameFood = (a, b) => NUTRIENTS.every((n) => a[n] === b[n]) && a.max_servings === b.max_servings && a.serving_size === b.serving_size;

  /* ---------- solver.py ---------- */
  let highsPromise = null;
  function loadHighs() {
    if (!highsPromise) {
      const factory = root.Module && typeof root.Module === "function" ? root.Module : require("highs");
      highsPromise = factory();
    }
    return highsPromise;
  }

  const fmtNum = (x) => (x === Infinity ? "inf" : x === -Infinity ? "-inf" : String(x));

  // Build a CPLEX-LP model. `A` rows are arrays of [col, coef] pairs.
  function lpText(obj, rows, lo, hi, colUb, intCols) {
    const v = (j) => `x${j}`;
    const expr = (pairs) => pairs.map(([j, c]) => `${c < 0 ? "-" : "+"} ${Math.abs(c)} ${v(j)}`).join(" ");
    const out = ["Minimize", ` obj: ${expr(obj.map((j) => [j, 1]))}`, "Subject To"];
    rows.forEach((pairs, i) => {
      const e = expr(pairs);
      if (lo[i] === hi[i]) out.push(` r${i}: ${e} = ${lo[i]}`);
      else {
        if (lo[i] > -Infinity) out.push(` r${i}l: ${e} >= ${lo[i]}`);
        if (hi[i] < Infinity) out.push(` r${i}u: ${e} <= ${hi[i]}`);
      }
    });
    out.push("Bounds");
    colUb.forEach((ub, j) => out.push(` 0 <= ${v(j)} <= ${fmtNum(ub)}`));
    if (intCols.length) out.push("General", " " + intCols.map(v).join(" "));
    out.push("End");
    return out.join("\n");
  }

  async function solve(highs, obj, rows, lo, hi, colUb, intCols, ncols) {
    const res = highs.solve(lpText(obj, rows, lo, hi, colUb, intCols), { mip_rel_gap: 1e-9 });
    if (res.Status !== "Optimal") throw new Error(`optimizer failed: ${res.Status}`);
    const x = new Array(ncols).fill(0);
    for (const [name, col] of Object.entries(res.Columns)) x[Number(name.slice(1))] = col.Primal;
    return { x, fun: res.ObjectiveValue };
  }

  async function suggestServings(foods, targets, base, { step = 0.5, maxCalorieShare = 0.5, tolerance = 0.05 } = {}) {
    if (!foods.length) throw new Error("need at least one candidate food");
    if (!targets.length) throw new Error("need at least one target");
    if (new Set(foods.map((f) => f.name)).size !== foods.length) throw new Error("candidate food names must be unique");

    const nf = foods.length, nt = targets.length;
    const F = NUTRIENTS.map((n) => foods.map((f) => f[n])); // nutrients x foods
    const rows = targets.map((t) => NUTRIENTS.indexOf(t.nutrient));
    const b = targets.map((t, j) => Math.max(t.value - base[rows[j]], 0) / t.value);

    // Upper bounds: per-food cap and calorie-share cap.
    let cap = foods.map((f) => f.max_servings);
    const calIdx = NUTRIENTS.indexOf("calories");
    const calTargets = targets.filter((t) => t.nutrient === "calories");
    if (calTargets.length) {
      const left = calTargets.map((t) => Math.max(t.value - base[calIdx], 0));
      const budget = calTargets.some((t) => t.kind === "max") ? Math.min(...left) : Math.max(...left);
      cap = cap.map((c, i) => Math.min(c, F[calIdx][i] > 0 ? (maxCalorieShare * budget) / F[calIdx][i] : Infinity));
    }

    // Columns: [food vars | slack columns | spread var t]
    const unit = step > 0 ? step : 1;
    const slackCols = [];
    let ncols = nf;
    for (const t of targets) {
      const k = t.kind === "exact" ? 2 : 1;
      slackCols.push(Array.from({ length: k }, (_, i) => ncols + i));
      ncols += k;
    }
    const tCol = ncols++;

    const colUb = new Array(ncols).fill(Infinity);
    cap.forEach((c, i) => (colUb[i] = step > 0 ? Math.floor(c / unit + EPS) : c));
    const intCols = step > 0 ? Array.from({ length: nf }, (_, i) => i) : [];

    const A = [], lo = [], hi = [];
    targets.forEach((t, j) => {
      const row = foods.map((_, i) => [i, (F[rows[j]][i] * unit) / t.value]);
      if (t.kind === "min") { row.push([slackCols[j][0], 1]); lo.push(b[j]); hi.push(Infinity); }
      else if (t.kind === "max") { row.push([slackCols[j][0], -1]); lo.push(-Infinity); hi.push(b[j]); }
      else { row.push([slackCols[j][0], 1], [slackCols[j][1], -1]); lo.push(b[j]); hi.push(b[j]); }
      A.push(row);
    });

    // Spread rows: unit*v_i - ref_i * t <= 0
    const finite = cap.filter(Number.isFinite);
    const finiteMax = finite.length ? Math.max(...finite) : 4;
    cap.forEach((c, i) => {
      A.push([[i, unit], [tCol, -(Number.isFinite(c) ? c : finiteMax)]]);
      lo.push(-Infinity);
      hi.push(0);
    });

    const highs = await loadHighs();
    const tiers = [...new Set(targets.map((t) => t.priority))].sort((a, c) => c - a);
    const lockRows = [], lockVals = [];
    const run = (obj) => solve(highs, obj, [...A, ...lockRows], [...lo, ...lockRows.map(() => -Infinity)], [...hi, ...lockVals], colUb, intCols, ncols);

    for (const tier of tiers) {
      const cols = targets.flatMap((t, j) => (t.priority === tier ? slackCols[j] : []));
      const res = await run(cols);
      lockRows.push(cols.map((j) => [j, 1]));
      lockVals.push(res.fun + 1e-7 + 1e-6 * Math.abs(res.fun));
    }
    const sol = await run([tCol]); // spread servings out

    let x = sol.x.slice(0, nf).map((v) => (step > 0 ? Math.round(v) * step : v * unit));
    x = x.map((v) => (v < EPS ? 0 : v));

    const added = NUTRIENTS.map((_, r) => F[r].reduce((s, a, i) => s + a * x[i], 0));
    const total = added.map((a, r) => a + base[r]);
    const toObj = (vec) => Object.fromEntries(NUTRIENTS.map((n, i) => [n, vec[i]]));

    const statuses = targets.map((t, j) => {
      const actual = total[rows[j]];
      const met = t.kind === "exact" ? Math.abs(actual - t.value) <= tolerance * t.value
        : t.kind === "min" ? actual >= t.value * (1 - tolerance)
        : actual <= t.value + EPS;
      return { t, actual, met };
    });

    const warnings = [];
    for (const s of statuses) {
      const t = s.t;
      if (t.kind === "max" && base[NUTRIENTS.indexOf(t.nutrient)] > t.value) {
        warnings.push(`${t.nutrient} is already over its max before any suggested food.`);
      } else if (!s.met) {
        warnings.push(`Could not meet ${t.nutrient} ${t.kind} ${t.value} (got ${s.actual.toFixed(1)}); try more candidate foods or a different priority.`);
      }
    }

    return {
      servings: Object.fromEntries(foods.flatMap((f, i) => (x[i] > 0 ? [[f.name, x[i]]] : []))),
      added: toObj(added),
      total: toObj(total),
      warnings,
      statuses: statuses.map((s) => ({
        nutrient: s.t.nutrient, kind: s.t.kind, priority: s.t.priorityName,
        target: s.t.value, actual: s.actual, met: s.met,
      })),
    };
  }

  async function calculate(payload) {
    const foods = [], eaten = new Map();
    for (const row of payload.foods || []) {
      const name = String(row.name ?? "").trim();
      if (!name) continue; // blank row
      const food = makeFood(name, row);
      foods.push(food);
      const n = num(row.eaten, `${name} eaten`);
      if (n > 0) {
        const prev = eaten.get(name);
        if (prev && !sameFood(prev.food, food)) throw new Error(`a different food named '${name}' is already logged`);
        eaten.set(name, { food, servings: n + (prev ? prev.servings : 0) });
      }
    }

    const base = NUTRIENTS.map(() => 0);
    for (const { food, servings } of eaten.values()) NUTRIENTS.forEach((n, i) => (base[i] += food[n] * servings));

    const targets = [];
    for (const g of payload.goals || []) {
      const kind = String(g.kind ?? "none").toLowerCase();
      if (kind === "none" || g.value === null || g.value === undefined || g.value === "") continue;
      const priorityName = String(g.priority ?? "normal").toUpperCase();
      if (!(priorityName in PRIORITY)) throw new Error(`unknown priority '${g.priority}'`);
      if (!NUTRIENTS.includes(g.nutrient)) throw new Error(`unknown nutrient '${g.nutrient}'; expected one of ${NUTRIENTS.join(", ")}`);
      if (!KINDS.includes(kind)) throw new Error(`'${kind}' is not a valid Kind`);
      const value = num(g.value, `${g.nutrient} goal`, null);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`target for ${g.nutrient} must be a positive number, got ${value}`);
      targets.push({ nutrient: g.nutrient, value, kind, priority: PRIORITY[priorityName], priorityName: priorityName.toLowerCase() });
    }

    const out = { logged_total: Object.fromEntries(NUTRIENTS.map((n, i) => [n, base[i]])), suggestion: null };
    if (foods.length && targets.length) out.suggestion = await suggestServings(foods, targets, base);
    return out;
  }

  const api = { calculate };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MacroSolver = api;
})(typeof window !== "undefined" ? window : globalThis);

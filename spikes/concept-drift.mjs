#!/usr/bin/env node
// SPIKE (issue #28) — concept drift, at the STRING level (translation-style).
//
// registry-drift (#22) catches copy referencing a `--flag`/verb that left the registry.
// Concept drift is the softer cousin: has a surface drifted from the canonical brand
// MESSAGES? Treat every string as a unit — exactly as i18n / translation does, whole
// messages, not single words — and ask, for each canonical string (the brand core's
// tokens), whether some surface string *means* it. A canon message with no close match =
// dropped/drifted; a surface string matching nothing = off-message copy. A *signal*,
// scored, for a human — not a gate.
//
// Matching is tiered (best available, graceful fallback), all string-level:
//   1. embeddings (semantic)   — paraphrases count ("keep it in its lane" ≈ "bounded
//      authority"); opt-in, keyed (fetch). The real one — sentence embeddings are what
//      models like text-embedding-3 are built for.
//   2. token overlap (stemmed) — shared content words, Jaccard; optional `stemmer`.
//   3. token overlap (exact)   — zero-dep baseline.
//
//   node spikes/concept-drift.mjs                       # sample surface vs the brand canon
//   node spikes/concept-drift.mjs path/to/strings.json  # a catalog's strings as the target
//   node extract.mjs page.html --emit > t.json && node spikes/concept-drift.mjs t.json
//   EMBED_API_KEY=… node spikes/concept-drift.mjs        # tier 1 (OpenAI-compatible)
//     (EMBED_URL/EMBED_MODEL/EMBED_THRESHOLD; OpenAI, Voyage-compat, or local ollama)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../catalog.mjs";

let stem = (w) => w, stemLabel = "exact";
try { ({ stemmer: stem } = await import("stemmer")); stemLabel = "stemmed"; } catch { /* optional */ }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CANON = join(root, "vendor/brand/content/strings.json"); // the registry core = the canonical messages

const STOP = new Set("a an and are as at be but by for from has have in into is it its no not of on or our that the their them they this to was we with you your".split(" "));
const wordSet = (s) => new Set((String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem));
const jaccard = (a, b) => { const inter = [...a].filter((x) => b.has(x)).length; const uni = new Set([...a, ...b]).size; return uni ? inter / uni : 0; };
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let k = 0; k < a.length; k++) { d += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };

// Every string is a unit — ALL of them, any length (translation works on whole messages).
const catalogStrings = (path) => Object.values(loadCatalog(path)).map((s) => s.value);
const htmlStrings = (path) => {
  const html = readFileSync(path, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out = [];
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["']/gi)) out.push(m[1]);          // meta copy
  for (const m of html.matchAll(/\b(?:alt|aria-label|placeholder|title)=["']([^"']+)["']/gi)) out.push(m[1]); // attr copy
  for (const s of html.replace(/<[^>]+>/g, "\n").replace(/&[a-z]+;|&#\d+;/gi, " ").split(/\n|(?<=[.!?])\s+/)) out.push(s); // visible text
  return out;
};
const clean = (arr) => [...new Set(arr.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => /[a-z]/i.test(s) && s.length >= 3))];

const target = process.argv[2] || join(root, "samples/page.html");
const canonStrings = clean(catalogStrings(CANON));
const targetStrings = clean(/\.html?$/.test(target) ? htmlStrings(target) : catalogStrings(target));

// ── tiered string similarity: sim(i, j) ∈ [0,1] between canon[i] and target[j] ──────────
let mode, sim, threshold;
const EMBED_KEY = process.env.EMBED_API_KEY;
if (EMBED_KEY) {
  const url = process.env.EMBED_URL || "https://api.openai.com/v1/embeddings";
  const model = process.env.EMBED_MODEL || "text-embedding-3-small";
  threshold = Number(process.env.EMBED_THRESHOLD || 0.6); // sentence cosines run higher than token Jaccard
  try {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${EMBED_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: [...canonStrings, ...targetStrings] }) });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    const v = (await res.json()).data.map((d) => d.embedding); // OpenAI-compatible response shape
    const cv = canonStrings.map((_, i) => v[i]);
    const tv = targetStrings.map((_, i) => v[canonStrings.length + i]);
    sim = (i, j) => cosine(cv[i], tv[j]);
    mode = `embeddings (${model} @ ${threshold})`;
  } catch (e) { console.error(`  (embeddings unavailable: ${e.message} — falling back)`); }
}
if (!mode) {
  threshold = Number(process.env.EMBED_THRESHOLD || 0.34);
  const cw = canonStrings.map(wordSet), tw = targetStrings.map(wordSet);
  sim = (i, j) => jaccard(cw[i], tw[j]);
  mode = `token overlap (${stemLabel})`;
}

const argmax = (n, f) => { let bj = -1, bv = -Infinity; for (let j = 0; j < n; j++) { const s = f(j); if (s > bv) { bv = s; bj = j; } } return { j: bj, s: Math.max(0, bv) }; };
const canonMatch = canonStrings.map((_, i) => argmax(targetStrings.length, (j) => sim(i, j)));
const covered = canonStrings.filter((_, i) => canonMatch[i].s >= threshold);
const coverage = canonStrings.length ? Math.round((covered.length / canonStrings.length) * 100) : 100;
const novel = targetStrings.filter((_, j) => argmax(canonStrings.length, (i) => sim(i, j)).s < threshold);

const trunc = (s, n = 50) => (s.length > n ? s.slice(0, n) + "…" : s);
console.log(`\n  CONCEPT DRIFT (string-level) — ${target.replace(root + "/", "")} vs the brand canon\n  ${"─".repeat(58)}`);
console.log(`  ${coverage}% of ${canonStrings.length} canon messages represented · ${novel.length}/${targetStrings.length} surface strings off-message · ${mode}`);
console.log(`\n  CANON MESSAGES → best surface match`);
canonStrings.forEach((c, i) => {
  const m = canonMatch[i], ok = m.s >= threshold;
  console.log(`     ${ok ? "✓" : "✗"} "${trunc(c)}"  (${m.s.toFixed(2)})${ok ? `  ← "${trunc(targetStrings[m.j], 38)}"` : "   — MISSING / drifted"}`);
});
if (novel.length) {
  console.log(`\n  OFF-MESSAGE — surface strings matching no canon message`);
  for (const s of novel.slice(0, 10)) console.log(`     · "${trunc(s)}"`);
}
console.log(`\n  signal, not a gate. Strings are the unit (like translation): does each canon message land, what's off-message?\n`);

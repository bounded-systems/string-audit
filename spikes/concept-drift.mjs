#!/usr/bin/env node
// SPIKE (issue #28) — concept drift.
//
// registry-drift (#22) catches copy referencing a `--flag`/verb that left the registry.
// Concept drift is the softer cousin: has a surface's copy drifted AWAY from the canonical
// brand CONCEPTS? The registry core (brand content tokens) encodes the message —
// "capability", "authority", "door", "agent", "bounded". A surface that stops saying them
// has gone generic (drift); a surface heavy on terms the canon never uses may be
// off-message. Neither is a hard error like ungrounded/registry-drift — it's a *signal*,
// scored, for a human.
//
// Three match tiers — best available wins, each falls back to the next:
//   1. embeddings (semantic) — synonyms count, "boundary" ≈ "scope"; opt-in, keyed (fetch).
//   2. stem-aware (porter)   — morphological variants, "agents" ≈ "agent"; optional `stemmer`.
//   3. lexical (exact)       — zero-dep baseline, always available.
//
//   node spikes/concept-drift.mjs                        # sample surface vs the brand canon
//   node spikes/concept-drift.mjs path/to/strings.json   # a catalog (DTCG/native) as the target
//   node spikes/concept-drift.mjs path/to/page.html      # an HTML surface as the target
//   node extract.mjs page.html --emit | …                # (extract a surface → a target catalog)
//   EMBED_API_KEY=… node spikes/concept-drift.mjs        # tier 1: OpenAI-compatible embeddings
//     (EMBED_URL/EMBED_MODEL/EMBED_THRESHOLD; works with OpenAI, Voyage-compat, local ollama)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../catalog.mjs";

// Tier 2 — optional stem-aware matching (retext's Porter `stemmer`): "capabilities" ≈
// "capability", "agents" ≈ "agent". Falls back to exact lexical (tier 3) if absent, so the
// spike stays runnable zero-dep. `npm i stemmer` to enable (it's an optionalDependency).
// Tier 1 (semantic embeddings) is set up below, gated on EMBED_API_KEY.
let stem = (w) => w, stemMode = "lexical (exact)";
try { ({ stemmer: stem } = await import("stemmer")); stemMode = "stem-aware (porter)"; } catch { /* fallback */ }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const CANON = join(root, "vendor/brand/content/strings.json"); // the registry core = the message

const STOP = new Set("a an and are as at be but by for from has have in into is it its no not of on or our that the their them they this to was we with you your every always".split(" "));
const terms = (text) => {
  const out = new Map();
  for (const w of String(text).toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    if (STOP.has(w)) continue;
    out.set(w, (out.get(w) ?? 0) + 1);
  }
  return out;
};
const catalogText = (path) => Object.values(loadCatalog(path)).map((s) => s.value).join("  ");
const htmlText = (path) => readFileSync(path, "utf8")
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/gi, " ");

const target = process.argv[2] || join(root, "samples/page.html");
const targetText = /\.html?$/.test(target) ? htmlText(target) : catalogText(target);

// canonical concepts = content terms the brand core uses ≥1×.
const canon = terms(catalogText(CANON));
const tgt = terms(targetText);
const canonWords = [...canon.keys()];
const tgtWords = [...tgt.keys()];

// Pick the best available match tier → hasConcept(word, i) / isNovel(word, i).
let mode, hasConcept, isNovel;
const EMBED_KEY = process.env.EMBED_API_KEY;
if (EMBED_KEY) {
  // Tier 1 — semantic: embed every canon + target term once, match by cosine ≥ threshold,
  // so synonyms the stemmer can't see still count ("boundary" ≈ "scope"). OpenAI-compatible.
  const url = process.env.EMBED_URL || "https://api.openai.com/v1/embeddings";
  const model = process.env.EMBED_MODEL || "text-embedding-3-small";
  const threshold = Number(process.env.EMBED_THRESHOLD || 0.5);
  const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
  try {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${EMBED_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: [...canonWords, ...tgtWords] }) });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    const vecs = (await res.json()).data.map((d) => d.embedding); // OpenAI-compatible response shape
    const cv = canonWords.map((_, i) => vecs[i]);
    const tv = tgtWords.map((_, i) => vecs[canonWords.length + i]);
    const maxSim = (v, set) => set.reduce((m, u) => Math.max(m, cosine(v, u)), 0);
    hasConcept = (_w, i) => maxSim(cv[i], tv) >= threshold;
    isNovel = (_w, i) => maxSim(tv[i], cv) < threshold;
    mode = `embeddings (${model} @ ${threshold})`;
  } catch (e) {
    console.error(`  (embeddings unavailable: ${e.message} — falling back to ${stemMode})`);
  }
}
if (!mode) {
  // Tiers 2/3 — stem-aware (if `stemmer` loaded) else exact lexical.
  const tgtStems = new Set(tgtWords.map(stem));
  const canonStems = new Set(canonWords.map(stem));
  hasConcept = (w) => tgtStems.has(stem(w));
  isNovel = (w) => !canonStems.has(stem(w));
  mode = stemMode;
}

const concepts = canonWords;
const covered = concepts.filter((c, i) => hasConcept(c, i));
const missing = concepts.filter((c, i) => !hasConcept(c, i));
const coverage = concepts.length ? Math.round((covered.length / concepts.length) * 100) : 100;
// novel = the target's most-used terms the canon never expresses (off-message drift)
const novel = [...tgt.entries()].filter(([w], i) => isNovel(w, i)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

console.log(`\n  CONCEPT DRIFT — ${target.replace(root + "/", "")} vs the brand canon\n  ${"─".repeat(52)}`);
console.log(`  ${coverage}% of canon concepts present · ${covered.length}/${concepts.length} covered · ${novel.length} novel terms · ${mode}`);
console.log(`\n  CANON CONCEPTS (the message)`);
console.log(`     ${concepts.map((c, i) => (hasConcept(c, i) ? c : `\x1b[2m${c}\x1b[0m`)).join(" · ")}`);
if (missing.length) {
  console.log(`\n  MISSING — canon concepts this surface dropped (drift?)`);
  console.log(`     ${missing.join(" · ")}`);
}
if (novel.length) {
  console.log(`\n  NOVEL — the surface's top terms the canon never uses (off-message?)`);
  console.log(`     ${novel.join(" · ")}`);
}
console.log(`\n  signal, not a gate: ${coverage}% concept coverage. Low % = generic/drifted; high novel = off-message.\n`);

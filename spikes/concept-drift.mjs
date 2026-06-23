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
// Zero-dep lexical proof-of-concept (term-overlap). A real version would use retext /
// embeddings for stem + synonym awareness — that's the next iteration this points at.
//
//   node spikes/concept-drift.mjs                       # the sample surface vs the brand canon
//   node spikes/concept-drift.mjs path/to/strings.json  # a catalog (DTCG/native) as the target
//   node spikes/concept-drift.mjs path/to/page.html     # an HTML surface as the target
//   node extract.mjs page.html --emit | …               # (extract a surface → a target catalog)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../catalog.mjs";

// Optional stem-aware matching (retext's Porter `stemmer`): "capabilities" ≈ "capability",
// "agents" ≈ "agent", "secured" ≈ "security"... Falls back to exact lexical match if
// `stemmer` isn't installed, so the spike stays runnable zero-dep. Enable: `npm i stemmer`
// (it's an optionalDependency). The next iteration past this is embeddings — synonym/
// semantic matches ("boundary" ≈ "scope") — which needs an embedding provider.
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

// canonical concepts = content terms the brand core uses ≥1×. Matching is by STEM (when
// available) so morphological variants count: "agents" covers "agent", etc.
const canon = terms(catalogText(CANON));
const tgt = terms(targetText);
const tgtStems = new Set([...tgt.keys()].map(stem));
const canonStems = new Set([...canon.keys()].map(stem));
const hasConcept = (w) => tgtStems.has(stem(w));
const concepts = [...canon.keys()];
const covered = concepts.filter(hasConcept);
const missing = concepts.filter((c) => !hasConcept(c));
const coverage = concepts.length ? Math.round((covered.length / concepts.length) * 100) : 100;
// novel = the target's most-used terms whose stem the canon never uses (off-message drift)
const novel = [...tgt.entries()].filter(([w]) => !canonStems.has(stem(w))).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

console.log(`\n  CONCEPT DRIFT — ${target.replace(root + "/", "")} vs the brand canon\n  ${"─".repeat(52)}`);
console.log(`  ${coverage}% of canon concepts present · ${covered.length}/${concepts.length} covered · ${novel.length} novel terms · ${stemMode}`);
console.log(`\n  CANON CONCEPTS (the message)`);
console.log(`     ${concepts.map((c) => (hasConcept(c) ? c : `\x1b[2m${c}\x1b[0m`)).join(" · ")}`);
if (missing.length) {
  console.log(`\n  MISSING — canon concepts this surface dropped (drift?)`);
  console.log(`     ${missing.join(" · ")}`);
}
if (novel.length) {
  console.log(`\n  NOVEL — the surface's top terms the canon never uses (off-message?)`);
  console.log(`     ${novel.join(" · ")}`);
}
console.log(`\n  signal, not a gate: ${coverage}% concept coverage. Low % = generic/drifted; high novel = off-message.\n`);

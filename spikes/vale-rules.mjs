#!/usr/bin/env node
// SPIKE (issue #6) — data-driven AI-tell scan with first-class severity tiers.
//
// Demonstrates the "port the rules, don't hand-maintain a lexicon" direction: the
// patterns/lexicon live in ai-tells.json (seeded from vale-signs-of-ai-writing), each
// rule carrying a level (error | warn | suggestion). aiTells() returns structured
// findings — { level, msg } — so a single severity model can be shared with a future
// Vale provider (see vale-provider.mjs). Zero-dep; nothing here is wired into audit.mjs.
//
//   node spikes/vale-rules.mjs            # run the demo on sample copy
//   node spikes/vale-rules.mjs "your string here"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The rules were promoted to the repo root (issue #6) and now back prose.mjs's aiIsms();
// this spike reads the same canonical file so it can't drift from production.
const RULES = JSON.parse(readFileSync(join(here, "..", "ai-tells.json"), "utf8"));
const compiled = RULES.patterns.map((p) => ({ re: new RegExp(p.re, p.flags || ""), why: p.why, level: p.level }));

// → [{ level: "error"|"warn"|"suggestion", msg }]
export function aiTells(value) {
  const out = [];
  for (const { re, why, level } of compiled) {
    const m = value.match(re);
    if (m) out.push({ level, msg: `${why} — "${m[0].trim().slice(0, 44)}"` });
  }
  const low = value.toLowerCase();
  for (const [level, words] of Object.entries(RULES.lexicon)) {
    const hits = words.filter((w) => low.includes(w));
    if (hits.length) out.push({ level, msg: `filler — ${hits.slice(0, 5).join(", ")}` });
  }
  const order = { error: 0, warn: 1, suggestion: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// glyph per tier (mirrors audit.mjs): ✗ error · ⚠ warn · · suggestion
const GLYPH = { error: "✗", warn: "⚠", suggestion: "·" };

// Demo when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const samples = process.argv[2]
    ? [process.argv[2]]
    : [
        "As an AI language model, I cannot provide medical advice.",
        "It isn't just a frame — it's a story.",
        "In today's fast-paced digital world, we leverage a seamless, robust platform.",
        "Check out [insert product name] — furthermore, it's worth noting it's a game-changer.",
        "The frame that fills itself with photos.",
      ];
  console.log(`\n  AI-TELLS SPIKE — ${compiled.length} patterns + lexicon, severity-tiered\n  ${"─".repeat(52)}`);
  for (const s of samples) {
    console.log(`\n  “${s.slice(0, 60)}${s.length > 60 ? "…" : ""}”`);
    const findings = aiTells(s);
    if (!findings.length) console.log("       (clean)");
    for (const f of findings) console.log(`       ${GLYPH[f.level]} [${f.level.padEnd(10)}] ${f.msg}`);
  }
  console.log();
}

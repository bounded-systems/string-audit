// Prose checks (deterministic, zero-API, not cached — cheap):
//   spellCheck   — words not in (modern wordlist ∪ custom dictionary.txt)
//   grammarCheck — weak-prose / style (write-good)
//   findOverlaps — symbols whose normalized value collides (dupe/near-dupe copy)
// Uses a portable modern wordlist (an-array-of-english-words) — no more 1934 web2.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const enWords = require("an-array-of-english-words"); // ~275k modern words (JSON array)
const writeGood = require("write-good");

const brand = new Set(
  readFileSync(join(here, "dictionary.txt"), "utf8")
    .split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")),
);
const base = new Set(enWords);
export const spellAvailable = true;
const known = (w) => brand.has(w) || base.has(w) || base.has(w.replace(/s$/, "")) || base.has(w.replace(/d$/, "")) || base.has(w.replace(/ing$/, ""));

export function spellCheck(value) {
  const words = (value.toLowerCase().match(/[a-z][a-z'’]+/g) || []).filter((w) => w.length > 2);
  const bad = [...new Set(words.map((w) => w.replace(/['’]s?$/, "")).filter((w) => !known(w)))];
  return bad.length ? [`spelling: ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? " …" : ""} (add to dictionary.txt if valid)`] : [];
}

export function grammarCheck(value) {
  return writeGood(value)
    .map((s) => `grammar/style: "${value.slice(s.index, s.index + s.offset)}" — ${s.reason}`)
    .slice(0, 4);
}

export function findOverlaps(catalog) {
  const byNorm = {};
  for (const [sym, { value }] of Object.entries(catalog)) {
    const n = value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    (byNorm[n] ||= []).push(sym);
  }
  return Object.values(byNorm).filter((g) => g.length > 1);
}

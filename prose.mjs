// Prose checks (deterministic, zero-dep, not cached — cheap + local):
//   spellCheck — words not in (base wordlist ∪ custom dictionary.txt)
//   findOverlaps — symbols whose normalized value collides (dupe/near-dupe copy)
// Base wordlist provider: $WORDLIST → /usr/share/dict/words → none (brand-dict only).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const brand = new Set(
  readFileSync(join(here, "dictionary.txt"), "utf8")
    .split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")),
);
const basePath = process.env.WORDLIST || ["/usr/share/dict/words", "/usr/share/dict/web2"].find((p) => existsSync(p));
const base = basePath ? new Set(readFileSync(basePath, "utf8").split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean)) : null;
export const spellAvailable = !!base;

const known = (w) => brand.has(w) || (!!base && (base.has(w) || base.has(w.replace(/s$/, "")) || base.has(w.replace(/ed$/, "")) || base.has(w.replace(/ing$/, ""))));

export function spellCheck(value) {
  if (!base) return []; // no base list → can't distinguish typos from real words
  const words = (value.toLowerCase().match(/[a-z][a-z'’]+/g) || []).filter((w) => w.length > 2);
  const bad = [...new Set(words.map((w) => w.replace(/['’]s?$/, "")).filter((w) => !known(w)))];
  return bad.length ? [`spelling: ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? " …" : ""} (add to dictionary.txt if valid)`] : [];
}

export function findOverlaps(catalog) {
  const byNorm = {};
  for (const [sym, { value }] of Object.entries(catalog)) {
    const norm = value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    (byNorm[norm] ||= []).push(sym);
  }
  return Object.values(byNorm).filter((g) => g.length > 1);
}

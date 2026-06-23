// Prose checks (deterministic, zero-API, not cached — cheap):
//   spellCheck   — words not in (modern wordlist ∪ custom dictionary.txt)
//   grammarCheck — weak-prose / style (write-good)
//   aiIsms       — formulaic "written by AI" cadences + buzzword filler (cold-read rule 4)
//   overclaims   — absolute, unprovable language (cold-read rule 5 / Lane C honesty)
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

// ── AI-isms (cold-read rule 4: "kill the AI-isms; proof-read") ──────────────────
// The formulaic cadences and filler that read as machine-written. Each finding names
// the tell so a human can rewrite it. Sourced verbatim from the cold read: no "easy
// part / hard part", no "it isn't X — it's Y" antithesis, no rule-of-three, no filler.
const AI_PATTERNS = [
  // "it isn't X — it's Y" antithesis (the cadence the cold read calls out by name)
  [/\b(?:isn'?t|aren'?t|wasn'?t|weren'?t|won'?t|don'?t|doesn'?t|not)\b[^.?!—–]{1,50}[—–][^.?!]{0,50}\b(?:it'?s|that'?s|but|they'?re|we'?re|it is|that is)\b/i,
    'antithesis "it isn\'t X — it\'s Y" cadence'],
  // "not just X, it's Y" / "not X, but Y" (the comma-form of the same antithesis)
  [/\bnot\s+(?:just|only|merely|simply|about)\b[^.?!]{1,50},\s*(?:but|it'?s|they'?re|it is|we)\b/i,
    '"not just X, it\'s Y" cadence'],
  // "the easy part … the hard part" framing
  [/\bthe\s+(?:easy|simple|fun|hard|tricky|tough|real|interesting|important)\s+part\b/i,
    '"the [easy/hard] part" framing'],
  // rhetorical teaser fragments
  [/\b(?:the\s+(?:best part|result|catch|kicker|bottom line|takeaway)\s*\?|sound familiar\?|here'?s the (?:thing|kicker|catch)|but here'?s)/i,
    'rhetorical teaser fragment'],
  [/\bnot only\b[^.?!]{1,60}\bbut also\b/i, '"not only … but also" cadence'],
  [/\bwhether you'?re\b[^.?!]{1,60}\bor\b/i, '"whether you\'re X or Y" cadence'],
  [/\bmore than just\b/i, '"more than just" cadence'],
];

// Filler/buzzword lexicon AI reaches for (single token or short phrase).
const AI_LEXICON = [
  "delve", "seamless", "seamlessly", "robust", "leverage", "elevate", "unlock", "harness",
  "realm", "tapestry", "testament", "embark", "foster", "bustling", "supercharge",
  "effortless", "effortlessly", "empower", "streamline", "game-changer", "game-changing",
  "cutting-edge", "best-in-class", "next-level", "transformative", "revolutionize",
  "ever-evolving", "ever-changing", "look no further", "rest assured", "when it comes to",
  "dive in", "deep dive", "in today's fast-paced", "fast-paced world", "needless to say",
  "it's worth noting", "the world of", "unleash", "turbocharge",
];

export function aiIsms(value) {
  const out = [];
  for (const [re, why] of AI_PATTERNS) {
    const m = value.match(re);
    if (m) out.push(`ai-ism: "${m[0].trim().slice(0, 48)}" — ${why}`);
  }
  const low = value.toLowerCase();
  const filler = AI_LEXICON.filter((w) => low.includes(w));
  if (filler.length) out.push(`ai-ism: filler — ${filler.slice(0, 4).join(", ")}${filler.length > 4 ? " …" : ""}`);
  // em-dash cadence: 3+ em/en dashes — more than a single legitimate parenthetical pair
  const dashes = (value.match(/[—–]/g) || []).length;
  if (dashes >= 3) out.push(`ai-ism: ${dashes} em-dashes — AI cadence; vary the punctuation`);
  // rule-of-three (a): anaphora — 3+ consecutive clauses opening with the same word
  const clauses = value.split(/[.;:!?—–]\s*|,\s+/).map((c) => c.trim()).filter(Boolean);
  const lead = (c) => (c.match(/^[a-z']+/i) || [""])[0].toLowerCase();
  for (let i = 0; i + 2 < clauses.length; i++) {
    const a = lead(clauses[i]);
    if (a.length >= 2 && a === lead(clauses[i + 1]) && a === lead(clauses[i + 2])) {
      out.push(`ai-ism: anaphora — 3 clauses opening "${a}…" (rule-of-three)`);
      break;
    }
  }
  // rule-of-three (b): parallel gerund tricolon — "touching X, running Y, doing Z"
  let ger = 0;
  for (const c of clauses) {
    if (/^[a-z]+ing\b/i.test(c)) { if (++ger >= 3) { out.push(`ai-ism: 3 parallel "-ing" clauses — rule-of-three tricolon`); break; } }
    else ger = 0;
  }
  // rule-of-three (c): adjacent triad — "fast, simple, and reliable"
  const triad = value.match(/\b([a-z]+),\s+([a-z]+),\s+and\s+([a-z]+)\b/i);
  if (triad && [triad[1], triad[2], triad[3]].every((w) => w.length > 2)) {
    out.push(`ai-ism: "${triad[0]}" — rule-of-three triad; vary it`);
  }
  return out.slice(0, 5);
}

// ── Overclaims (cold-read rule 5: provenance / "Lane C honesty") ─────────────────
// Absolute, unprovable language — the prose analogue of the grounding check. The cold
// read's rule is specifically about coverage: never claim "every privileged effect".
// So an absolute quantifier only fires when it's bound to a coverage/security term —
// ordinary prose ("never the credential behind it", "doing something you never asked
// for") is left alone. Plus a few standalone marketing absolutes that are low-FP.
const COVERAGE =
  "(?:effect|action|request|write|call|access|tool|command|input|case|secure|safe|signed|enforced|block(?:ed|s)?|protect|prevent|verif|audit|cover|guard)";
const ABSOLUTES = [
  // coverage overclaim — the cold read's "every privileged effect" shape (either order)
  [new RegExp(`\\b(?:every|all|always|never|any)\\b[^.?!]{0,30}\\b${COVERAGE}`, "i"), "absolute coverage claim — scope it or link a source"],
  [new RegExp(`\\b${COVERAGE}[a-z]*\\b[^.?!]{0,20}\\b(?:every|all|always|never)\\b`, "i"), "absolute coverage claim — scope it or link a source"],
  // standalone marketing absolutes (low false-positive)
  [/\bguarantee(?:d|s)?\b/i, "guaranteed — unprovable absolute"],
  [/\b100\s*%/, "100% — unprovable absolute"],
  [/\b(?:completely|entirely|fully|totally)\s+(?:secure|safe|private|protected|covered)\b/i, "absolute security claim"],
  [/\bno\b[^.?!]{0,30}\bever\b/i, '"no … ever" — absolute claim'],
];

export function overclaims(value) {
  const out = [];
  for (const [re, why] of ABSOLUTES) {
    const m = value.match(re);
    if (m) out.push(`overclaim: "${m[0].trim().slice(0, 40)}" — ${why} (Lane C honesty)`);
  }
  return out.slice(0, 3);
}

export function findOverlaps(catalog) {
  const byNorm = {};
  for (const [sym, { value }] of Object.entries(catalog)) {
    const n = value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    (byNorm[n] ||= []).push(sym);
  }
  return Object.values(byNorm).filter((g) => g.length > 1);
}

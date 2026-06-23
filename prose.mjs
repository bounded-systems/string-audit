// Prose checks (deterministic, zero-API, not cached — cheap). Every check returns
// findings as { level, msg } so severity is first-class (audit.mjs derives the glyph
// from level, not by regex'ing the message). Levels: error | warn | suggestion.
//   spellCheck   — words not in (modern wordlist ∪ custom dictionary.txt)         [error]
//   grammarCheck — weak-prose / style (write-good)                            [suggestion]
//   aiIsms       — formulaic "written by AI" cadences + filler, from ai-tells.json [mixed]
//   overclaims   — absolute, unprovable language (cold-read rule 5 / Lane C)       [error]
//   proofread    — mechanical defects spell/grammar miss                            [warn]
//   readability  — over-long / dense copy you bounce off                      [suggestion]
//   findOverlaps — symbols whose normalized value collides (dupe/near-dupe copy)
// AI-tell patterns/lexicon live in ai-tells.json (data, not code) so they track the
// upstream vale-signs-of-ai-writing corpus; see issue #6. Structural tells that aren't
// simple regex (em-dash count, anaphora, tricolons) stay in aiIsms() below.
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
// English contractions ("isn't", "we're", "it's") — valid, not misspellings.
const isContraction = (w) => /^[a-z]+n['’]t$/.test(w) || /^[a-z]+['’](s|re|ve|ll|d|m)$/.test(w);

// Severity ordering — error first. Shared by checks that sort their own findings.
const RANK = { error: 0, warn: 1, suggestion: 2 };
const bySeverity = (a, b) => RANK[a.level] - RANK[b.level];

export function spellCheck(value) {
  const words = (value.toLowerCase().match(/[a-z][a-z'’]+/g) || []).filter((w) => w.length > 2 && !isContraction(w));
  const bad = [...new Set(words.map((w) => w.replace(/['’]s?$/, "")).filter((w) => !known(w)))];
  return bad.length ? [{ level: "error", msg: `spelling: ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? " …" : ""} (add to dictionary.txt if valid)` }] : [];
}

export function grammarCheck(value) {
  return writeGood(value)
    .map((s) => ({ level: "suggestion", msg: `grammar/style: "${value.slice(s.index, s.index + s.offset)}" — ${s.reason}` }))
    .slice(0, 4);
}

// ── AI-isms (cold-read rule 4: "kill the AI-isms; proof-read") ──────────────────
// Patterns + lexicon are data (ai-tells.json); each rule carries its own severity.
const RULES = JSON.parse(readFileSync(join(here, "ai-tells.json"), "utf8"));
const AI_RULES = RULES.patterns.map((p) => ({ re: new RegExp(p.re, p.flags || ""), why: p.why, level: p.level }));
const AI_LEXICON = RULES.lexicon; // { suggestion: [...], ... }

export function aiIsms(value) {
  const out = [];
  for (const { re, why, level } of AI_RULES) {
    const m = value.match(re);
    if (m) out.push({ level, msg: `ai-ism: "${m[0].trim().slice(0, 48)}" — ${why}` });
  }
  const low = value.toLowerCase();
  for (const [level, words] of Object.entries(AI_LEXICON)) {
    const hits = words.filter((w) => low.includes(w));
    if (hits.length) out.push({ level, msg: `ai-ism: filler — ${hits.slice(0, 4).join(", ")}${hits.length > 4 ? " …" : ""}` });
  }
  // ── structural tells that aren't simple regex (stay in code), all warn ──
  const warn = (msg) => out.push({ level: "warn", msg });
  // em-dash cadence: 3+ em/en dashes — more than a single legitimate parenthetical pair.
  // Kept at `suggestion`, never `warn`: voice-forward copy uses em-dashes intentionally,
  // so it must not light up a gate keyed on warn/error (downstream note, consumers' body).
  const dashes = (value.match(/[—–]/g) || []).length;
  if (dashes >= 3) out.push({ level: "suggestion", msg: `ai-ism: ${dashes} em-dashes — AI cadence; vary the punctuation` });
  const clauses = value.split(/[.;:!?—–]\s*|,\s+/).map((c) => c.trim()).filter(Boolean);
  const lead = (c) => (c.match(/^[a-z']+/i) || [""])[0].toLowerCase();
  // rule-of-three (a): anaphora — 3+ consecutive clauses opening with the same word
  for (let i = 0; i + 2 < clauses.length; i++) {
    const a = lead(clauses[i]);
    if (a.length >= 2 && a === lead(clauses[i + 1]) && a === lead(clauses[i + 2])) {
      warn(`ai-ism: anaphora — 3 clauses opening "${a}…" (rule-of-three)`);
      break;
    }
  }
  // rule-of-three (b): parallel gerund tricolon — "touching X, running Y, doing Z"
  let ger = 0;
  for (const c of clauses) {
    if (/^[a-z]+ing\b/i.test(c)) { if (++ger >= 3) { warn(`ai-ism: 3 parallel "-ing" clauses — rule-of-three tricolon`); break; } }
    else ger = 0;
  }
  // rule-of-three (c): adjacent triad — "fast, simple, and reliable"
  const triad = value.match(/\b([a-z]+),\s+([a-z]+),\s+and\s+([a-z]+)\b/i);
  if (triad && [triad[1], triad[2], triad[3]].every((w) => w.length > 2)) {
    warn(`ai-ism: "${triad[0]}" — rule-of-three triad; vary it`);
  }
  return out.sort(bySeverity).slice(0, 6);
}

// ── Overclaims (cold-read rule 5: provenance / "Lane C honesty") ─────────────────
// Absolute, unprovable language — the prose analogue of the grounding check. Only fires
// when an absolute quantifier is bound to a coverage/security term (the "every privileged
// effect" shape); ordinary "never"/"always" in plain prose is left alone.
const COVERAGE =
  "(?:effect|action|request|write|call|access|tool|command|input|case|secure|safe|signed|enforced|block(?:ed|s)?|protect|prevent|verif|audit|cover|guard)";
const ABSOLUTES = [
  [new RegExp(`\\b(?:every|all|always|never|any)\\b[^.?!]{0,30}\\b${COVERAGE}`, "i"), "absolute coverage claim — scope it or link a source"],
  [new RegExp(`\\b${COVERAGE}[a-z]*\\b[^.?!]{0,20}\\b(?:every|all|always|never)\\b`, "i"), "absolute coverage claim — scope it or link a source"],
  [/\bguarantee(?:d|s)?\b/i, "guaranteed — unprovable absolute"],
  [/\b100\s*%/, "100% — unprovable absolute"],
  [/\b(?:completely|entirely|fully|totally)\s+(?:secure|safe|private|protected|covered)\b/i, "absolute security claim"],
  [/\bno\b[^.?!]{0,30}\bever\b/i, '"no … ever" — absolute claim'],
];

export function overclaims(value) {
  const out = [];
  for (const [re, why] of ABSOLUTES) {
    const m = value.match(re);
    if (m) out.push({ level: "error", msg: `overclaim: "${m[0].trim().slice(0, 40)}" — ${why} (Lane C honesty)` });
  }
  return out.slice(0, 3);
}

// ── Proofreading (cold-read: "not sure if proof read") ──────────────────────────
// High-confidence mechanical defects spell/grammar miss — the "was this even
// proof-read?" tells. Conservative on purpose: every rule here should be a real slip.
export function proofread(value) {
  const out = [];
  const warn = (msg) => out.push({ level: "warn", msg });
  const dup = value.match(/\b([a-z]{2,})\s+\1\b/i);
  if (dup) warn(`proofread: doubled word "${dup[1]} ${dup[1]}"`);
  if (/ {2,}/.test(value)) warn("proofread: double space");
  if (/\s[,.;:!?]/.test(value)) warn("proofread: space before punctuation");
  if (/[a-z],[a-z]/i.test(value)) warn("proofread: missing space after comma");
  if (/[!?]{2,}/.test(value) || /\.{4,}/.test(value)) warn("proofread: repeated punctuation");
  if (/['"]/.test(value) && /[‘’“”]/.test(value)) warn("proofread: mixed straight + curly quotes");
  if (/^\s|\s$/.test(value)) warn("proofread: leading/trailing whitespace");
  return out;
}

// ── Readability (cold-read: "why am I reading this" — couldn't parse it) ─────────
// Flags copy you bounce off: over-long sentences, and (for body/meta) genuinely dense
// prose by Flesch reading-ease. A deterministic proxy for "I didn't get through this".
const syllables = (w) => Math.max(1, (w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g) || []).length);
export function readability(value, type = "body") {
  const out = [];
  const sug = (msg) => out.push({ level: "suggestion", msg });
  const sentences = value.split(/[.!?]+\s+|[.!?]+$/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const n = (s.match(/\b[\w'-]+\b/g) || []).length;
    if (n > 28) sug(`readability: long sentence (${n} words) — hard to scan; split it`);
  }
  if ((type === "body" || type === "meta") && sentences.length) {
    const words = value.match(/\b[\w'-]+\b/g) || [];
    if (words.length >= 12) {
      const syl = words.reduce((a, w) => a + syllables(w), 0);
      const fre = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length);
      if (fre < 35) sug(`readability: dense prose (reading ease ${Math.round(fre)}/100) — shorter words + sentences`);
    }
  }
  return out.slice(0, 3);
}

// ── Registry drift (issue #22) — copy vs the verbspec registry ───────────────────
// string-audit owns a typed registry (verbs.mjs). Copy that names a `--flag` or an enum
// value not in the registry has drifted from the actual surface (renamed/removed/typo'd)
// — a correctness defect, like an ungrounded claim. Pure: takes a `vocab`, so prose.mjs
// stays free of verbspec/zod; verbs.mjs builds the vocab from the projected verb schemas
// (toMcpTool(...).inputSchema — JSON Schema: `properties` keys + per-prop `enum`).
export function vocabFromSchemas(schemas) {
  const flags = new Set(["help", "version"]); // always-valid globals
  const enums = {};
  for (const s of schemas) {
    for (const [name, prop] of Object.entries(s?.properties ?? {})) {
      flags.add(name.toLowerCase());
      if (Array.isArray(prop?.enum)) enums[name.toLowerCase()] = new Set(prop.enum.map((x) => String(x).toLowerCase()));
    }
  }
  return { flags, enums };
}

const DRIFT_FLAG = /(?<![\w-])--([a-z][a-z0-9-]*)/gi; // a CLI flag, not a prose double-hyphen
const driftEnumRef = (name) => new RegExp(`\\b(?:--${name}[ =]|${name.toUpperCase()}=)([a-z][a-z0-9-]*)`, "gi");

export function registryDrift(value, vocab) {
  if (!vocab || !vocab.flags || vocab.flags.size <= 2) return []; // no vocab → no-op, never false-positive
  const out = [];
  const seen = new Set();
  for (const m of value.matchAll(DRIFT_FLAG)) {
    const flag = m[1].toLowerCase();
    if (!vocab.flags.has(flag) && !seen.has("f:" + flag)) {
      seen.add("f:" + flag);
      out.push({ level: "error", msg: `registry-drift: --${flag} is not a flag of any verb (renamed/removed/typo?)` });
    }
  }
  for (const [name, allowed] of Object.entries(vocab.enums || {})) {
    for (const m of value.matchAll(driftEnumRef(name))) {
      const val = m[1].toLowerCase();
      if (!allowed.has(val) && !seen.has(`e:${name}:${val}`)) {
        seen.add(`e:${name}:${val}`);
        out.push({ level: "error", msg: `registry-drift: ${name}=${val} — not a valid value (${[...allowed].join("|")})` });
      }
    }
  }
  return out;
}

export function findOverlaps(catalog) {
  const byNorm = {};
  for (const [sym, { value }] of Object.entries(catalog)) {
    const n = value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    (byNorm[n] ||= []).push(sym);
  }
  return Object.values(byNorm).filter((g) => g.length > 1);
}

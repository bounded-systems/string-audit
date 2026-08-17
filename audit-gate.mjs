#!/usr/bin/env node
// Deterministic content gate — prose + grounding checks. No API calls, no JSR deps.
// Intended to be checked out into a site's CI as a submodule or workflow_call step;
// prose.mjs runs directly (requires an-array-of-english-words + write-good in the
// caller's node_modules — satisfied by the caller's own `npm ci`).
//
// Env vars (all optional except CATALOG):
//   CATALOG   path to the typed-symbol catalog JSON (required)
//   GROUNDING path to grounding-facts JSON — either a flat array of terms (a single repo
//             auditing its own catalog) or a namespaced { "<repo>": [terms] } map (the
//             org-wide aggregate, where repo X's claims are groundable only by X's terms).
//             Both shapes are accepted; see grounding.mjs.
//   ATTESTED  path to attested-claims JSON (array of { symbol, check })
//
// Flags:
//   --strict  exit 1 when any non-attested error-level finding exists
//
// Attested-claims format:
//   [{ "symbol": "brand.claim.foo", "check": "overclaim" }]
//   `check` is matched against the check-name prefix of the finding message
//   (e.g. "overclaim" matches "overclaim: \"every effect\" — ...").
//   An entry with no symbol ("" or absent) matches that check on any symbol.

import { readFileSync, existsSync } from "node:fs";
import { aiIsms, overclaims, proofread, readability, verbVariety, phraseReuse } from "./prose.mjs";
import { loadCatalog } from "./catalog.mjs";
import { STAT_RE, isGrounded, isNamespaced, repoFor, termsFor } from "./grounding.mjs";

const strict = process.argv.includes("--strict");

const catalogPath = process.env.CATALOG;
if (!catalogPath) {
  console.error("audit-gate: CATALOG env var is required");
  process.exit(1);
}

const catalog = loadCatalog(catalogPath);

const GROUNDING =
  process.env.GROUNDING && existsSync(process.env.GROUNDING)
    ? JSON.parse(readFileSync(process.env.GROUNDING, "utf8"))
    : [];
const NAMESPACED = isNamespaced(GROUNDING);

const attestedRaw =
  process.env.ATTESTED && existsSync(process.env.ATTESTED)
    ? JSON.parse(readFileSync(process.env.ATTESTED, "utf8"))
    : [];

// attested key: "<symbol>::<check>" — empty symbol matches any symbol
const attestedSet = new Set(
  attestedRaw.map(({ symbol = "", check = "" }) => `${symbol}::${check.toLowerCase()}`)
);
const checkName = (msg) => msg.split(":")[0].toLowerCase();
const isAttested = (symbol, msg) => {
  const c = checkName(msg);
  return attestedSet.has(`${symbol}::${c}`) || attestedSet.has(`::${c}`);
};

// Grounding check. The matcher itself lives in grounding.mjs (zero-dep, so importing it
// here does not drag verbs.mjs → store.mjs → JSR deps in) and is shared with the
// deterministic "claim" logic in types.mjs, so the CI gate and the CLI/MCP path cannot
// drift apart. The message strings stay here: `checkName` below splits on ":" to match
// ATTESTED entries, so the "grounding:" prefix is load-bearing.
function groundingFindings(symbol, value) {
  const terms = termsFor(symbol, GROUNDING);
  if (isGrounded(value, terms)) return [];

  // Under a namespaced source, "this repo declared no grounding at all" and "this repo's
  // terms don't back this claim" are very different maintainer problems — say which.
  const repo = NAMESPACED ? repoFor(symbol, GROUNDING) : null;
  const scope = !NAMESPACED
    ? ""
    : repo === null
      ? " — no grounding declared for this symbol's repo"
      : terms.length === 0
        ? ` — ${repo} declares an empty grounding set`
        : ` — not in ${repo}'s grounding`;

  const stat = value.match(STAT_RE);
  return stat
    ? [{ level: "error", msg: `grounding: UNGROUNDED stat "${stat[0].trim()}" — not in grounding source${scope}` }]
    : [{ level: "error", msg: `grounding: claim asserts nothing grounded — verify against source${scope}` }];
}

const ORDER = { error: 0, warn: 1, suggestion: 2 };
const GLYPH = { error: "✗", warn: "⚠", suggestion: "·" };

let totalErrors = 0;
const symbolsWithFindings = [];

for (const [symbol, { type, value }] of Object.entries(catalog)) {
  const raw = [
    ...aiIsms(value),
    ...overclaims(value),
    ...proofread(value),
    ...readability(value, type),
    ...(type === "claim" ? groundingFindings(symbol, value) : []),
  ];

  if (!raw.length) continue;

  const findings = raw
    .map((f) => (isAttested(symbol, f.msg) ? { ...f, level: "suggestion" } : f))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  const errors = findings.filter((f) => f.level === "error").length;
  totalErrors += errors;
  symbolsWithFindings.push({ symbol, type, findings });
}

const symCount = Object.keys(catalog).length;
// Name the grounding mode: a namespaced source silently read as flat (or vice versa) is
// exactly the kind of thing that should never be invisible in the log.
const groundingMode = NAMESPACED
  ? `namespaced · ${Object.keys(GROUNDING).filter((k) => !k.startsWith("$")).length} repo(s)`
  : `flat · ${GROUNDING.length} term(s)`;
console.log(`\n  AUDIT GATE — prose + grounding · ${symCount} symbol${symCount !== 1 ? "s" : ""} · grounding: ${groundingMode}\n  ${"─".repeat(52)}`);

for (const { symbol, type, findings } of symbolsWithFindings) {
  console.log(`  ${symbol.padEnd(24)} [${type.padEnd(8)}]`);
  for (const f of findings) console.log(`       ${GLYPH[f.level]} ${f.msg}`);
}

// Corpus-level repetition (verb variety + phrase reuse) — report-only: every finding
// is suggestion-tier, so it surfaces the smell without ever failing --strict.
const corpus = [...verbVariety(catalog), ...phraseReuse(catalog)];
if (corpus.length) {
  console.log(`\n  REPETITION — across all ${symCount} symbol${symCount !== 1 ? "s" : ""} (report-only)`);
  for (const f of corpus) console.log(`       ${GLYPH[f.level]} ${f.msg}`);
}

const attestedNote = attestedRaw.length ? ` · ${attestedRaw.length} attested (demoted to suggestion)` : "";
console.log(`\n  ${totalErrors} error(s)${attestedNote}`);
console.log(`  tiers: ✗ error · ⚠ warn · · suggestion\n`);

if (strict && totalErrors > 0) {
  console.error(`  ✗ gate failed — ${totalErrors} error(s) under --strict\n`);
  process.exit(1);
}

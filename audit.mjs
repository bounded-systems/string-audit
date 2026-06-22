#!/usr/bin/env node
// string-audit spike — typed symbols, type-scoped audits, CAS-memoized.
// Deterministic local checks stand in for the LLM audit so the spike runs offline;
// the real Anthropic call plugs into the cache-MISS path (marked below). Re-running
// is free for unchanged symbols — only the diff costs an API call.
//
//   node audit.mjs           # audit; second run = 0 calls (all cached)
//   AUDIT_VERSION=2 node …   # bump to invalidate the whole cache intentionally
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditWithAnthropic } from "./anthropic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const AUDIT_VERSION = process.env.AUDIT_VERSION || "1";
const cacheDir = join(here, ".cache");
mkdirSync(cacheDir, { recursive: true });
const catalog = JSON.parse(readFileSync(join(here, "catalog.json"), "utf8"));
const useLLM = !!process.env.ANTHROPIC_API_KEY; // real audits when keyed; deterministic otherwise

// grounding source — the only facts a `claim` may assert (stand-in for PDP/spec sheet)
const GROUNDED = ["no subscription", "one-time purchase", "text", "email", "web upload", "unlimited photos", "wifi", "digital photo frame", "no app"];

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const cacheKey = (type, value) => sha(`${AUDIT_VERSION}:${type}:${value}`);

// type → audit (deterministic stand-in; the LLM call goes where noted on a miss)
const AUDITS = {
  headline: (v) => [
    v.length > 65 && "too long for a headline (>65)",
    v.length < 15 && "too short to carry the value prop",
    /\b(best|amazing|world-class|revolutionary)\b/i.test(v) && "superlative filler",
  ].filter(Boolean),
  cta: (v) => [
    !/^(shop|get|buy|try|start|send|order|gift)\b/i.test(v.trim()) && "doesn't open with an action verb",
    v.length > 24 && "CTA too long to scan",
  ].filter(Boolean),
  meta: (v) => [
    v.length > 160 && `meta ${v.length}>160 chars`,
    v.length < 70 && "meta thin (<70)",
  ].filter(Boolean),
  claim: (v) => {
    const stat = v.match(/\b\d[\d,. ]*\s*(%|stars?|customers?|reviews?|bpm|days?|x)\b/i);
    const grounded = GROUNDED.some((g) => v.toLowerCase().includes(g));
    return [
      stat && !grounded && `UNGROUNDED stat "${stat[0].trim()}" — not in the grounding source; flag, never ship/rewrite as fact`,
      !stat && !grounded && "claim asserts nothing grounded — verify against source",
    ].filter(Boolean);
  },
};

const run = (type, value) => {
  const findings = (AUDITS[type] || (() => []))(value);
  return { score: Math.max(0, 10 - 2 * findings.length), findings };
};

let hits = 0, misses = 0;
const results = {};
for (const [symbol, { type, value }] of Object.entries(catalog)) {
  const f = join(cacheDir, cacheKey(type, value) + ".json");
  let r, cached;
  if (existsSync(f)) { r = JSON.parse(readFileSync(f, "utf8")); cached = true; hits++; }
  else {
    // ───── cache MISS: the expensive call. Real Anthropic audit when keyed. ─────
    r = useLLM ? await auditWithAnthropic({ type, value, grounding: GROUNDED }) : run(type, value);
    writeFileSync(f, JSON.stringify(r));
    cached = false; misses++;
  }
  results[symbol] = { type, ...r, cached };
}

// run-to-run deltas (the ▲▼ view), per symbol
const lastFile = join(here, ".last.json");
const last = existsSync(lastFile) ? JSON.parse(readFileSync(lastFile, "utf8")) : {};
writeFileSync(lastFile, JSON.stringify(Object.fromEntries(Object.entries(results).map(([s, r]) => [s, r.score]))));

console.log(`\n  STRING AUDIT — ${Object.keys(catalog).length} symbols · audit v${AUDIT_VERSION} · ${useLLM ? "anthropic" : "deterministic"}\n  ${"─".repeat(52)}`);
for (const [s, r] of Object.entries(results)) {
  const prev = last[s];
  const d = prev == null ? "" : r.score > prev ? ` ▲+${r.score - prev}` : r.score < prev ? ` ▼${r.score - prev}` : "";
  console.log(`  ${r.cached ? "·" : "✦"} ${s.padEnd(20)} [${r.type.padEnd(8)}] ${r.score}/10${d}`);
  for (const finding of r.findings) console.log(`       ✗ ${finding}`);
}
console.log(`\n  cache: ${hits} hit (free) · ${misses} miss (= API calls this run)`);
console.log(`  ✦ computed   · served from CAS\n`);

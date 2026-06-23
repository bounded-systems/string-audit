#!/usr/bin/env node
// SPIKE — static-string extraction over SOURCE (i18n-style), Zod-typed keepers.
//
// Translation/i18n tooling scans source for EVERY string literal. Most don't matter
// (identifiers, paths, keys, log plumbing); the few that do — hardcoded user-facing copy —
// are exactly the strings that should be externalized into typed SYMBOLS with a real
// contract. This spike does both halves:
//   1. extract — walk the .mjs/.js/.ts source, pull every string + simple-template literal.
//   2. classify — keeper (looks like copy) vs incidental (code).
//   3. type + validate — infer a symbol type for each keeper and check it against a Zod
//      schema for that type (headline ≤65, cta opens with an action verb, meta ≤160 …).
//   4. emit — a DTCG content/strings.json of the keepers (incidental stay as a count).
//
// So "all static strings" get surfaced; "Zod + symbols" applies to the ones that matter.
// Extraction uses `acorn` (AST — comments/regexes/code-between-strings can't fool it) when
// installed, else a noisier regex fallback so the spike still runs. (HTML surfaces are the
// `extract` verb's job; this is hardcoded strings in code.)
//
//   node spikes/scan.mjs [dir]          # report: keepers (typed + Zod-validated) vs incidental
//   node spikes/scan.mjs [dir] --emit   # emit a content/strings.json of the keepers
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : join(here, "..");
const EMIT = process.argv.includes("--emit");
const IGNORE = new Set(["node_modules", ".git", "vendor", "dist", ".cache", ".room", "spikes"]);

let acorn = null, parseMode = "regex (heuristic)";
try { acorn = await import("acorn"); parseMode = "acorn AST"; } catch { /* fallback */ }

// ── 1. Zod type contracts — the symbols that matter get a real schema per type ──────────
const TYPES = {
  headline: z.string().min(8).max(65),
  cta: z.string().min(2).max(24).regex(/^(shop|get|buy|try|start|send|order|gift|read|learn|see|join|explore|run|use|add)\b/i, "open with an action verb"),
  meta: z.string().min(50).max(160),
  claim: z.string().min(8),
  body: z.string().min(8),
};
const inferType = (s) =>
  /^(shop|get|buy|try|start|send|order|gift|read|learn|see|join|explore|run|use|add)\b/i.test(s) && s.length <= 24 ? "cta" :
  /\b(every|always|guaranteed|never|100%|rated|\d+\s*(?:stars?|customers?|reviews?))\b/i.test(s) ? "claim" :
  s.length >= 50 && s.length <= 160 ? "meta" :
  /^[A-Z][^.!?]{0,63}$/.test(s.trim()) && s.length <= 65 ? "headline" :
  "body";

// ── 2. extract every string literal from a file ─────────────────────────────────────────
function literalsOf(src) {
  if (acorn) {
    const out = [];
    let ast; try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" }); } catch { return out; }
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return void n.forEach(walk);
      if (n.type === "Literal" && typeof n.value === "string") out.push(n.value);
      else if (n.type === "TemplateLiteral" && n.expressions.length === 0) out.push(n.quasis.map((q) => q.value.cooked).join(""));
      for (const k in n) if (k !== "type" && n[k] && typeof n[k] === "object") walk(n[k]);
    };
    walk(ast);
    return out;
  }
  const out = [];
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) out.push((m[1] ?? m[2]).replace(/\\(["'\\])/g, "$1"));
  return out;
}

const filesUnder = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || IGNORE.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (/\.(mjs|js|ts)$/.test(e.name) && !/(^|\.)test\.(mjs|js|ts)$/.test(e.name)) out.push(p); // skip tests (test data ≠ app copy)
  }
  return out;
};

// ── 3. keeper heuristic — does this literal read like user-facing copy, not code? ───────
const isKeeper = (s) => {
  const t = s.trim();
  if (t.length < 8 || !/[a-z]/i.test(t)) return false;
  if (!/[a-z]\s+[a-z]/i.test(t)) return false;                          // needs ≥2 word-ish tokens
  if (/^(\.{0,2}\/|~\/|https?:|[a-z][\w-]*:\/\/)/.test(t)) return false;  // path / url
  if (/\.(mjs|js|ts|json|html?|css|svg|png|jpe?g|md|txt|sock|key)\b/i.test(t)) return false; // filename/ext
  if (/[{}<>|]|=>|\$\{|::|\bconsole\.|\bconst\s|\breturn\s|\bfunction\b/.test(t)) return false; // code
  if (/^[a-z][a-zA-Z0-9_.-]*$/.test(t)) return false;                   // identifier / dotted key
  if (!/[A-Z]/.test(t) && !/[.!?]/.test(t)) return false;               // sentence-like: a capital or sentence punctuation
  return true;
};

const files = filesUnder(ROOT);
let literals = 0;
const keepers = []; // { value, type, file, valid, error }
const seen = new Set();
for (const f of files) {
  for (const s of literalsOf(readFileSync(f, "utf8"))) {
    literals++;
    const t = s.trim();
    if (!isKeeper(t) || seen.has(t)) continue;
    seen.add(t);
    const type = inferType(t);
    const r = TYPES[type].safeParse(t);
    keepers.push({ value: t, type, file: relative(ROOT, f), valid: r.success, error: r.success ? null : r.error.issues[0]?.message });
  }
}

const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 5).join("-");
if (EMIT) {
  const doc = { "$description": `Keeper strings scanned from ${basename(ROOT)} (${keepers.length} of ${literals} literals, ${parseMode}). Typed; review + adopt as content tokens.` };
  for (const k of keepers) doc[`scan.${k.type}.${slug(k.value)}`] = { "$value": k.value, "$type": k.type, "$description": `from ${k.file}${k.valid ? "" : ` (⚠ ${k.error})`}` };
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
} else {
  const trunc = (s, n = 58) => (s.length > n ? s.slice(0, n) + "…" : s);
  const invalid = keepers.filter((k) => !k.valid);
  console.log(`\n  STATIC-STRING SCAN — ${basename(ROOT)} (${parseMode})\n  ${"─".repeat(52)}`);
  console.log(`  ${files.length} files · ${literals} string literals · ${keepers.length} keepers (typed copy) · ${literals - keepers.length} incidental`);
  console.log(`\n  KEEPERS — hardcoded copy → propose a typed symbol (Zod-validated)`);
  for (const k of keepers.slice(0, 40)) console.log(`     ${k.valid ? "✓" : "✗"} [${k.type.padEnd(8)}] "${trunc(k.value)}"  ·${k.file}${k.valid ? "" : `  ⚠ ${k.error}`}`);
  if (keepers.length > 40) console.log(`     … and ${keepers.length - 40} more`);
  console.log(`\n  ${invalid.length} keeper(s) violate their type's Zod contract — fix the copy or retype.`);
  console.log(`  --emit to write a content/strings.json of the keepers.\n`);
}

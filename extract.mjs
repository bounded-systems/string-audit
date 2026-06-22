#!/usr/bin/env node
// Token extraction + coverage (#2/#3). Scan an HTML surface for hardcoded visible
// strings, infer a type, and reconcile against the catalog:
//   covered   — already a symbol (good)
//   uncovered — hardcoded on the surface → propose a typed symbol (i18n-extract)
//   unused    — catalog symbols that don't appear on this surface (dead copy?)
//   node extract.mjs <surface.html>
import { readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error("usage: node extract.mjs <surface.html>"); process.exit(2); }
const catalog = JSON.parse(readFileSync(join(here, "catalog.json"), "utf8"));

const html = readFileSync(file, "utf8")
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "");

const norm = (s) => s.replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
const meaningful = (s) => s.length >= 3 && /[a-z]/i.test(s) && !/^[\d\s\W]+$/.test(s);
const typeOf = (tag, attr) =>
  attr === "meta" ? "meta" : attr ? "alt" :
  /^h1$/i.test(tag) ? "headline" : /^h[2-6]$/i.test(tag) ? "subhead" :
  /button/i.test(tag) ? "cta" : /^title$/i.test(tag) ? "title" : "body";

const found = new Map(); // normValue → { value, type, where }
const add = (value, type, where) => { const v = norm(value); if (meaningful(v) && !found.has(v.toLowerCase())) found.set(v.toLowerCase(), { value: v, type, where }); };
for (const m of html.matchAll(/<(h1|h2|h3|h4|title|button|a|p|li|span|strong|em)\b[^>]*>([^<]+)</gi)) add(m[2], typeOf(m[1]), m[1].toLowerCase());
for (const m of html.matchAll(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/gi)) add(m[1], "meta", "meta");
for (const m of html.matchAll(/\b(alt|aria-label|placeholder)=["']([^"']+)["']/gi)) add(m[2], "alt", m[1].toLowerCase());

const surface = [...found.values()];
const catVals = new Map(Object.entries(catalog).map(([sym, { value }]) => [norm(value).toLowerCase(), sym]));
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-");

const covered = surface.filter((f) => catVals.has(f.value.toLowerCase()));
const uncovered = surface.filter((f) => !catVals.has(f.value.toLowerCase()));
const surfaceVals = new Set(surface.map((f) => f.value.toLowerCase()));
const unused = Object.entries(catalog).filter(([, { value }]) => !surfaceVals.has(norm(value).toLowerCase()));

const cov = surface.length ? Math.round((covered.length / surface.length) * 100) : 100;
console.log(`\n  EXTRACT + COVERAGE — ${basename(file)}\n  ${"─".repeat(54)}`);
console.log(`  ${cov}% covered · ${surface.length} surface strings · ${covered.length} symbols · ${uncovered.length} hardcoded · ${unused.length} unused`);
console.log(`\n  UNCOVERED — hardcoded → propose a symbol`);
for (const f of uncovered) console.log(`     + "${f.value.length > 42 ? f.value.slice(0, 42) + "…" : f.value}"  [${f.type}] → surface.${f.where}.${slug(f.value)}`);
console.log(`\n  UNUSED — catalog symbols not on this surface`);
for (const [s] of unused) console.log(`     - ${s}`);
console.log("");

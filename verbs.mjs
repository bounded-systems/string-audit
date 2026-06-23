// Spec-driven surfaces — `audit` and `extract` authored ONCE as verbspec VerbSpecs, so
// the CLI bins (audit.mjs / extract.mjs), the MCP toolset (mcp.mjs), and any
// OpenAPI/Anthropic projection read one typed contract. `run` computes the structured
// `output` (what MCP/agents consume); `render` is the human CLI view (the bins print it).
// CLI knobs default from the same env vars the scripts always used, so `same env/args`.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineVerb, toMcpTool } from "@bounded-systems/verbspec";
import { auditWithAnthropic } from "./anthropic.mjs";
import { spellCheck, grammarCheck, aiIsms, overclaims, proofread, readability, findOverlaps, registryDrift, vocabFromToolset } from "./prose.mjs";
import { valeLint } from "./vale.mjs";
import { textlintLint } from "./textlint.mjs";
import { loadCatalog } from "./catalog.mjs";
import { makeStore } from "./store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Default catalog = the real semantic-key registry: bounded-systems/brand's canonical
// content tokens, vendored as a submodule (vendor/brand). DTCG format, parsed by
// loadCatalog. Point CATALOG=<path> at a surface's merged content/strings.json instead.
const DEFAULT_CATALOG = join(here, "vendor/brand/content/strings.json");
const Finding = z.object({ level: z.enum(["error", "warn", "suggestion"]), msg: z.string() });
const GLYPH = { error: "✗", warn: "⚠", suggestion: "·" }; // cf. Vale severities
const ORDER = { error: 0, warn: 1, suggestion: 2 };

// ── audit ───────────────────────────────────────────────────────────────────────
// Deterministic type-scoped stand-ins; the LLM call replaces them on a cache miss.
const deterministicAudits = (GROUNDED) => ({
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
});

export const auditVerb = defineVerb({
  id: "audit",
  summary: "Audit every catalog symbol (type-scoped + prose), CAS-cached; report scores + findings.",
  actor: "audit",
  input: z.object({
    catalog: z.string().optional().describe("Path to the typed-symbol catalog (default $CATALOG or the vendored brand registry, vendor/brand/content/strings.json)."),
    grounding: z.string().optional().describe("Path to the grounding facts a `claim` may assert (default $GROUNDING / sibling)."),
    store: z.enum(["fs", "cas", "socket"]).optional().describe("Result store backend (default $STORE or fs)."),
    version: z.string().optional().describe("Cache version; bump to invalidate (default $AUDIT_VERSION or 1)."),
    vale: z.boolean().optional().describe("Fold in the optional Vale provider (else $AUDIT_VALE)."),
  }),
  output: z.object({
    version: z.string(),
    provider: z.enum(["anthropic", "deterministic"]),
    symbols: z.array(z.object({
      symbol: z.string(),
      type: z.string(),
      score: z.number(),
      cached: z.boolean(),
      delta: z.number().nullable(), // vs the previous run, null when first-seen
      findings: z.array(Finding),
    })),
    overlaps: z.array(z.array(z.string())),
    cache: z.object({ hits: z.number(), misses: z.number() }),
  }),
  run: async (input) => {
    const catalogPath = input.catalog ?? process.env.CATALOG ?? DEFAULT_CATALOG;
    const catalog = loadCatalog(catalogPath);
    // grounding source: explicit flag → $GROUNDING → per-catalog sibling → default
    const groundingFile = [
      input.grounding,
      process.env.GROUNDING,
      (input.catalog || process.env.CATALOG) && join(dirname(catalogPath), "grounding.json"),
      join(here, "grounding.json"),
    ].filter(Boolean).find(existsSync);
    const GROUNDED = groundingFile ? JSON.parse(readFileSync(groundingFile, "utf8")) : [];
    const AUDIT_VERSION = input.version ?? process.env.AUDIT_VERSION ?? "1";
    // --store / --vale override the deep, runtime-read env knobs (makeStore / valeLint);
    // model + key stay env-only. The CLI is one-shot; the MCP server isolates env per call.
    if (input.store) process.env.STORE = input.store;
    if (input.vale) process.env.AUDIT_VALE = "1";

    const cacheDir = join(here, ".cache");
    mkdirSync(cacheDir, { recursive: true });
    const useLLM = !!process.env.ANTHROPIC_API_KEY;
    const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
    const cacheKey = (type, value) => sha(`${AUDIT_VERSION}:${type}:${value}`);
    const AUDITS = deterministicAudits(GROUNDED);
    const runDet = (type, value) => {
      const findings = (AUDITS[type] || (() => []))(value);
      return { score: Math.max(0, 10 - 2 * findings.length), findings };
    };

    const store = await makeStore(cacheDir);
    let hits = 0, misses = 0;
    const results = {};
    for (const [symbol, { type, value }] of Object.entries(catalog)) {
      const key = cacheKey(type, value);
      let r = await store.has(key) ? await store.get(key) : null;
      const cached = !!r;
      if (cached) hits++;
      else {
        r = useLLM ? await auditWithAnthropic({ type, value, grounding: GROUNDED }) : runDet(type, value);
        await store.put(key, r);
        misses++;
      }
      results[symbol] = { type, ...r, cached };
    }

    // run-to-run deltas (the ▲▼ view), per symbol — persisted in .last.json
    const lastFile = join(here, ".last.json");
    const last = existsSync(lastFile) ? JSON.parse(readFileSync(lastFile, "utf8")) : {};
    writeFileSync(lastFile, JSON.stringify(Object.fromEntries(Object.entries(results).map(([s, r]) => [s, r.score]))));

    const typeLevel = (m) => /UNGROUNDED|grounded/i.test(m) ? "error" : "suggestion";
    // Build the registry vocab once (not per-symbol) from verbspec's public MCP projection,
    // so registryDrift stays pure/verbspec-free and a zod bump can't silently degrade it.
    const vocab = vocabFromToolset(Object.values(registry).map((vb) => toMcpTool(vb)));
    // textlintLint is async (dynamic import); all others are sync. Run async prose in parallel,
    // sync prose inline. The map returns Promises, which we settle via Promise.all.
    const symbols = await Promise.all(Object.entries(results).map(async ([s, r]) => {
      const v = catalog[s].value;
      // prose checks carry first-class severity ({ level, msg }); the scored, cached
      // type-audit findings are strings — classify them into the same model + sort.
      const prose = [
        ...spellCheck(v), ...grammarCheck(v), ...aiIsms(v), ...overclaims(v),
        ...proofread(v), ...readability(v, r.type), ...valeLint(v),
        ...(await textlintLint(v)),
        ...registryDrift(v, r.type, vocab),
      ];
      const findings = [...r.findings.map((m) => ({ level: typeLevel(m), msg: m })), ...prose]
        .sort((a, b) => ORDER[a.level] - ORDER[b.level]);
      const prev = last[s];
      return { symbol: s, type: r.type, score: r.score, cached: r.cached, delta: prev == null ? null : r.score - prev, findings };
    }));

    return {
      version: AUDIT_VERSION,
      provider: useLLM ? "anthropic" : "deterministic",
      symbols,
      overlaps: findOverlaps(catalog),
      cache: { hits, misses },
    };
  },
  render: (out) => {
    // One entry per legacy console.log line; joined with a trailing newline each so the
    // bytes match the pre-verbspec audit.mjs output exactly.
    const lines = [`\n  STRING AUDIT — ${out.symbols.length} symbols · audit v${out.version} · ${out.provider}\n  ${"─".repeat(52)}`];
    for (const s of out.symbols) {
      const d = s.delta == null ? "" : s.delta > 0 ? ` ▲+${s.delta}` : s.delta < 0 ? ` ▼${s.delta}` : "";
      lines.push(`  ${s.cached ? "·" : "✦"} ${s.symbol.padEnd(20)} [${s.type.padEnd(8)}] ${s.score}/10${d}`);
      for (const f of s.findings) lines.push(`       ${GLYPH[f.level]} ${f.msg}`);
    }
    if (out.overlaps.length) {
      lines.push("\n  OVERLAP — duplicate copy across symbols");
      for (const g of out.overlaps) lines.push(`     ⧉ ${g.join("  =  ")}`);
    }
    lines.push(`\n  cache: ${out.cache.hits} hit (free) · ${out.cache.misses} miss (= API calls this run)`);
    lines.push(`  prose: spell + grammar + ai-isms + overclaims + proofread + readability + registry-drift (uncached)`);
    lines.push(`  tiers: ✗ correctness/honesty · ⚠ ai-ism/proofread · · suggestion`);
    lines.push(`  ✦ computed   · served from CAS\n`);
    return lines.map((l) => l + "\n").join("");
  },
});

// ── extract ───────────────────────────────────────────────────────────────────────
const meaningful = (s) => s.length >= 3 && /[a-z]/i.test(s) && !/^[\d\s\W]+$/.test(s);
const normHtml = (s) => s.replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
const typeOf = (tag, attr) =>
  attr === "meta" ? "meta" : attr ? "alt" :
  /^h1$/i.test(tag) ? "headline" : /^h[2-6]$/i.test(tag) ? "subhead" :
  /button/i.test(tag) ? "cta" : /^title$/i.test(tag) ? "title" : "body";
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-");

export const extractVerb = defineVerb({
  id: "extract",
  summary: "Scan an HTML surface for hardcoded copy and reconcile it against the catalog.",
  actor: "audit",
  input: z.object({
    file: z.string().describe("Path to the HTML surface to scan."),
    catalog: z.string().optional().describe("Path to the typed-symbol catalog (default $CATALOG or the vendored brand registry, vendor/brand/content/strings.json)."),
  }),
  positionals: ["file"],
  output: z.object({
    file: z.string(),
    coverage: z.number(),
    surface: z.number(),
    covered: z.number(),
    uncovered: z.array(z.object({ value: z.string(), type: z.string(), where: z.string(), symbol: z.string() })),
    unused: z.array(z.string()),
  }),
  run: (input) => {
    const catalogPath = input.catalog ?? process.env.CATALOG ?? DEFAULT_CATALOG;
    const catalog = loadCatalog(catalogPath);
    const html = readFileSync(input.file, "utf8")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");

    const found = new Map(); // normValue → { value, type, where }
    const add = (value, type, where) => {
      const v = normHtml(value);
      if (meaningful(v) && !found.has(v.toLowerCase())) found.set(v.toLowerCase(), { value: v, type, where });
    };
    for (const m of html.matchAll(/<(h1|h2|h3|h4|title|button|a|p|li|span|strong|em)\b[^>]*>([^<]+)</gi)) add(m[2], typeOf(m[1]), m[1].toLowerCase());
    for (const m of html.matchAll(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/gi)) add(m[1], "meta", "meta");
    for (const m of html.matchAll(/\b(alt|aria-label|placeholder)=["']([^"']+)["']/gi)) add(m[2], "alt", m[1].toLowerCase());

    const surface = [...found.values()];
    const catVals = new Map(Object.entries(catalog).map(([sym, { value }]) => [normHtml(value).toLowerCase(), sym]));
    const surfaceVals = new Set(surface.map((f) => f.value.toLowerCase()));
    const coveredArr = surface.filter((f) => catVals.has(f.value.toLowerCase()));
    const uncovered = surface.filter((f) => !catVals.has(f.value.toLowerCase()))
      .map((f) => ({ value: f.value, type: f.type, where: f.where, symbol: `surface.${f.where}.${slug(f.value)}` }));
    const unused = Object.entries(catalog).filter(([, { value }]) => !surfaceVals.has(normHtml(value).toLowerCase())).map(([s]) => s);

    return {
      file: basename(input.file),
      coverage: surface.length ? Math.round((coveredArr.length / surface.length) * 100) : 100,
      surface: surface.length,
      covered: coveredArr.length,
      uncovered,
      unused,
    };
  },
  render: (out) => {
    const trunc = (v) => (v.length > 42 ? v.slice(0, 42) + "…" : v);
    const lines = [
      `\n  EXTRACT + COVERAGE — ${out.file}\n  ${"─".repeat(54)}`,
      `  ${out.coverage}% covered · ${out.surface} surface strings · ${out.covered} symbols · ${out.uncovered.length} hardcoded · ${out.unused.length} unused`,
      `\n  UNCOVERED — hardcoded → propose a symbol`,
      ...out.uncovered.map((f) => `     + "${trunc(f.value)}"  [${f.type}] → ${f.symbol}`),
      `\n  UNUSED — catalog symbols not on this surface`,
      ...out.unused.map((s) => `     - ${s}`),
      ``,
    ];
    return lines.map((l) => l + "\n").join("");
  },
});

// One typed registry → CLI bins + the MCP toolset (mcp.mjs). `report` is Anthropic-only
// (a tool-use surface, not server-callable), so it stays out of the runnable registry.
export const registry = { audit: auditVerb, extract: extractVerb };

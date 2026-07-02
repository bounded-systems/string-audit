// Spec-driven surfaces — `audit` and `extract` authored ONCE as verbspec VerbSpecs, so
// the CLI bins (audit.mjs / extract.mjs), the MCP toolset (mcp.mjs), and any
// OpenAPI/Anthropic projection read one typed contract. `run` computes the structured
// `output` (what MCP/agents consume); `render` is the human CLI view (the bins print it).
// CLI knobs default from the same env vars the scripts always used, so `same env/args`.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineVerb, toMcpTool } from "@bounded-systems/verbspec";
import { auditWithAnthropic } from "./anthropic.mjs";
import { spellCheck, grammarCheck, aiIsms, overclaims, proofread, readability, findOverlaps, registryDrift, vocabFromToolset } from "./prose.mjs";
import { typeFindings, claimFindings, inferType, SYMBOL_TYPES } from "./types.mjs";
import { valeLint } from "./vale.mjs";
import { textlintLint } from "./textlint.mjs";
import { loadCatalog } from "./catalog.mjs";
import { makeStore } from "./store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Default catalog = the real semantic-key registry: bounded-systems/brand's canonical
// content tokens, from the @bounded-systems/brand npm dependency. DTCG format, parsed
// by loadCatalog. Point CATALOG=<path> at a surface's merged content/strings.json instead.
const DEFAULT_CATALOG = join(here, "node_modules/@bounded-systems/brand/content/strings.json");
const Finding = z.object({ level: z.enum(["error", "warn", "suggestion"]), msg: z.string() });
const GLYPH = { error: "✗", warn: "⚠", suggestion: "·" }; // cf. Vale severities
const ORDER = { error: 0, warn: 1, suggestion: 2 };

// ── audit ───────────────────────────────────────────────────────────────────────
export const auditVerb = defineVerb({
  id: "audit",
  summary: "Audit every catalog symbol (type-scoped + prose), CAS-cached; report scores + findings.",
  actor: "audit",
  input: z.object({
    catalog: z.string().optional().describe("Path to the typed-symbol catalog (default $CATALOG or the vendored brand registry, node_modules/@bounded-systems/brand/content/strings.json)."),
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
    // type-scoped checks from the shared Zod contracts (types.mjs); claim is grounding-aware.
    const runDet = (type, value) => {
      const findings = type === "claim" ? claimFindings(value, GROUNDED) : typeFindings(type, value);
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
      provider: /** @type {"anthropic" | "deterministic"} */ (useLLM ? "anthropic" : "deterministic"),
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
    catalog: z.string().optional().describe("Path to the typed-symbol catalog (default $CATALOG or the vendored brand registry, node_modules/@bounded-systems/brand/content/strings.json)."),
    emit: z.boolean().optional().describe("Emit a DTCG content/strings.json of the surface's strings (instead of the coverage report) — bootstrap a catalog from a page."),
  }),
  positionals: ["file"],
  output: z.object({
    file: z.string(),
    coverage: z.number(),
    surface: z.number(),
    covered: z.number(),
    uncovered: z.array(z.object({ value: z.string(), type: z.string(), where: z.string(), symbol: z.string() })),
    unused: z.array(z.string()),
    // DTCG tokens for every surface string (covered reuse their catalog symbol, uncovered
    // get the proposed key) — what `--emit` writes, and what MCP callers get to seed a catalog.
    tokens: z.record(z.string(), z.object({ "$value": z.string(), "$type": z.string(), "$description": z.string() })),
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

    // every surface string → a DTCG token (covered reuse their catalog symbol; uncovered
    // take the proposed key) so `--emit` can seed/merge a content/strings.json from the page.
    /** @type {Record<string, { "$value": string, "$type": string, "$description": string }>} */
    const tokens = {};
    for (const f of surface) {
      const key = catVals.get(f.value.toLowerCase()) ?? `surface.${f.where}.${slug(f.value)}`;
      tokens[key] = { "$value": f.value, "$type": f.type, "$description": `extracted from ${basename(input.file)} (<${f.where}>)` };
    }

    return {
      file: basename(input.file),
      coverage: surface.length ? Math.round((coveredArr.length / surface.length) * 100) : 100,
      surface: surface.length,
      covered: coveredArr.length,
      uncovered,
      unused,
      tokens,
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

// ── scan ────────────────────────────────────────────────────────────────────────
// Static-string extraction over SOURCE (i18n-style): pull every string literal, keep the
// ones that read like user-facing copy, infer a type and Zod-validate it (types.mjs — the
// same contracts `audit` uses). All static strings surfaced; Zod + symbols for the keepers.
const SCAN_IGNORE = new Set(["node_modules", ".git", "vendor", "dist", ".cache", ".room"]);
const sourceFiles = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SCAN_IGNORE.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(mjs|js|ts)$/.test(e.name) && !/(^|\.)test\.(mjs|js|ts)$/.test(e.name)) out.push(p); // skip tests (test data ≠ app copy)
  }
  return out;
};
const isCopy = (s) => {
  const t = s.trim();
  if (t.length < 8 || !/[a-z]/i.test(t)) return false;
  if (!/[a-z]\s+[a-z]/i.test(t)) return false;                          // ≥2 word-ish tokens
  if (/^(\.{0,2}\/|~\/|https?:|[a-z][\w-]*:\/\/)/.test(t)) return false;  // path / url
  if (/\.(mjs|js|ts|json|html?|css|svg|png|jpe?g|md|txt|sock|key)\b/i.test(t)) return false; // filename
  if (/[{}<>|]|=>|\$\{|::|\bconsole\.|\bconst\s|\breturn\s|\bfunction\b/.test(t)) return false; // code
  if (/^[a-z][a-zA-Z0-9_.-]*$/.test(t)) return false;                   // identifier / dotted key
  if (!/[A-Z]/.test(t) && !/[.!?]/.test(t)) return false;               // sentence-like
  return true;
};

export const scanVerb = defineVerb({
  id: "scan",
  summary: "Scan source for hardcoded static strings; type + Zod-validate the keepers.",
  actor: "audit",
  input: z.object({
    dir: z.string().optional().describe("Source root to scan (default: string-audit's own root)."),
    emit: z.boolean().optional().describe("Emit a DTCG content/strings.json of the keepers (instead of the report)."),
  }),
  positionals: ["dir"],
  output: z.object({
    dir: z.string(),
    parser: z.string(),
    files: z.number(),
    literals: z.number(),
    incidental: z.number(),
    keepers: z.array(z.object({ value: z.string(), type: z.string(), file: z.string(), valid: z.boolean(), error: z.string().nullable() })),
  }),
  run: async (input) => {
    const root = input.dir ?? here;
    let acorn = null, parser = "regex (heuristic)";
    try { acorn = await import("acorn"); parser = "acorn AST"; } catch { /* fallback */ } // AST can't be fooled by comments/regexes
    const literalsOf = (src) => {
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
    };
    const files = sourceFiles(root);
    let literals = 0;
    const keepers = [];
    const seen = new Set();
    for (const f of files) {
      for (const s of literalsOf(readFileSync(f, "utf8"))) {
        literals++;
        const t = s.trim();
        if (!isCopy(t) || seen.has(t)) continue;
        seen.add(t);
        const type = inferType(t);
        const schema = SYMBOL_TYPES[type];                  // structural contract (types.mjs); claim's grounding is N/A out of catalog context
        const r = schema ? schema.safeParse(t) : { success: true };
        keepers.push({ value: t, type, file: relative(root, f), valid: r.success, error: r.success ? null : r.error.issues[0].message });
      }
    }
    return { dir: basename(root), parser, files: files.length, literals, incidental: literals - keepers.length, keepers };
  },
  render: (out) => {
    const trunc = (s, n = 58) => (s.length > n ? s.slice(0, n) + "…" : s);
    const invalid = out.keepers.filter((k) => !k.valid).length;
    const lines = [
      `\n  STATIC-STRING SCAN — ${out.dir} (${out.parser})\n  ${"─".repeat(52)}`,
      `  ${out.files} files · ${out.literals} string literals · ${out.keepers.length} keepers (typed copy) · ${out.incidental} incidental`,
      `\n  KEEPERS — hardcoded copy → propose a typed symbol (Zod-validated)`,
      ...out.keepers.slice(0, 40).map((k) => `     ${k.valid ? "✓" : "✗"} [${k.type.padEnd(8)}] "${trunc(k.value)}"  ·${k.file}${k.valid ? "" : `  ⚠ ${k.error}`}`),
      ...(out.keepers.length > 40 ? [`     … and ${out.keepers.length - 40} more`] : []),
      `\n  ${invalid} keeper(s) violate their type's Zod contract — fix the copy or retype.`,
      `  --emit to write a content/strings.json of the keepers.\n`,
    ];
    return lines.map((l) => l + "\n").join("");
  },
});

// One typed registry → CLI bins + the MCP toolset (mcp.mjs). `report` is Anthropic-only.
// ── concept-drift ───────────────────────────────────────────────────────────────
// The softer cousin of registry-drift (#28): has a surface drifted from the canonical
// brand MESSAGES? Treat every string as a unit (i18n/translation-style) and ask, for each
// canon message, whether a surface string means it. Tiered matching, best-available +
// graceful fallback: embeddings (semantic, opt-in EMBED_API_KEY) → token overlap (stemmed,
// optional `stemmer`) → token overlap (exact). A signal, not a gate.
const CD_STOP = new Set("a an and are as at be but by for from has have in into is it its no not of on or our that the their them they this to was we with you your".split(" "));
const jaccard = (a, b) => { const inter = [...a].filter((x) => b.has(x)).length; const uni = new Set([...a, ...b]).size; return uni ? inter / uni : 0; };
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let k = 0; k < a.length; k++) { d += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
const catalogStrings = (path) => Object.values(loadCatalog(path)).map((s) => s.value);
const htmlStrings = (path) => {
  const html = readFileSync(path, "utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out = [];
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["']/gi)) out.push(m[1]);          // meta copy
  for (const m of html.matchAll(/\b(?:alt|aria-label|placeholder|title)=["']([^"']+)["']/gi)) out.push(m[1]); // attr copy
  for (const s of html.replace(/<[^>]+>/g, "\n").replace(/&[a-z]+;|&#\d+;/gi, " ").split(/\n|(?<=[.!?])\s+/)) out.push(s); // visible text
  return out;
};
const cleanStrings = (arr) => [...new Set(arr.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => /[a-z]/i.test(s) && s.length >= 3))];
const argmax = (n, f) => { let bj = -1, bv = -Infinity; for (let j = 0; j < n; j++) { const s = f(j); if (s > bv) { bv = s; bj = j; } } return { j: bj, s: Math.max(0, bv) }; };

export const conceptDriftVerb = defineVerb({
  id: "concept-drift",
  summary: "Has a surface drifted from the canonical brand messages? Per-message coverage vs the registry core.",
  actor: "audit",
  input: z.object({
    target: z.string().optional().describe("Catalog (.json) or HTML surface to check (default: the sample surface)."),
    canon: z.string().optional().describe("Canonical catalog to compare against (default: the vendored brand registry)."),
  }),
  positionals: ["target"],
  output: z.object({
    target: z.string(),
    mode: z.string(),
    coverage: z.number(),
    canon: z.number(),
    surface: z.number(),
    messages: z.array(z.object({ value: z.string(), score: z.number(), represented: z.boolean(), match: z.string().nullable() })),
    offMessage: z.array(z.string()),
  }),
  run: async (input) => {
    let stem = (/** @type {string} */ w) => w, stemLabel = "exact";
    try { ({ stemmer: stem } = await import("stemmer")); stemLabel = "stemmed"; } catch { /* optional */ }
    const wordSet = (s) => new Set((String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !CD_STOP.has(w)).map(stem));
    const targetPath = input.target ?? join(here, "samples/page.html");
    const canonStrings = cleanStrings(catalogStrings(input.canon ?? DEFAULT_CATALOG));
    const targetStrings = cleanStrings(/\.html?$/.test(targetPath) ? htmlStrings(targetPath) : catalogStrings(targetPath));

    let mode, sim, threshold;
    const EMBED_KEY = process.env.EMBED_API_KEY;
    if (EMBED_KEY) {
      const url = process.env.EMBED_URL || "https://api.openai.com/v1/embeddings";
      const model = process.env.EMBED_MODEL || "text-embedding-3-small";
      threshold = Number(process.env.EMBED_THRESHOLD || 0.6); // sentence cosines run higher than token Jaccard
      try {
        const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${EMBED_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: [...canonStrings, ...targetStrings] }) });
        if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
        const v = (/** @type {any} */ (await res.json())).data.map((/** @type {any} */ d) => d.embedding); // OpenAI-compatible response shape
        const cv = canonStrings.map((_, i) => v[i]);
        const tv = targetStrings.map((_, i) => v[canonStrings.length + i]);
        sim = (i, j) => cosine(cv[i], tv[j]);
        mode = `embeddings (${model} @ ${threshold})`;
      } catch (e) { process.stderr.write(`  (embeddings unavailable: ${e instanceof Error ? e.message : e} — falling back)\n`); }
    }
    if (!mode) {
      threshold = Number(process.env.EMBED_THRESHOLD || 0.34);
      const cw = canonStrings.map(wordSet), tw = targetStrings.map(wordSet);
      sim = (i, j) => jaccard(cw[i], tw[j]);
      mode = `token overlap (${stemLabel})`;
    }

    const canonMatch = canonStrings.map((_, i) => argmax(targetStrings.length, (j) => sim(i, j)));
    const messages = canonStrings.map((c, i) => ({ value: c, score: Number(canonMatch[i].s.toFixed(3)), represented: canonMatch[i].s >= threshold, match: canonMatch[i].j >= 0 && canonMatch[i].s >= threshold ? targetStrings[canonMatch[i].j] : null }));
    const offMessage = targetStrings.filter((_, j) => argmax(canonStrings.length, (i) => sim(i, j)).s < threshold);
    const represented = messages.filter((m) => m.represented).length;
    return {
      target: basename(targetPath),
      mode,
      coverage: canonStrings.length ? Math.round((represented / canonStrings.length) * 100) : 100,
      canon: canonStrings.length,
      surface: targetStrings.length,
      messages,
      offMessage,
    };
  },
  render: (out) => {
    const trunc = (s, n = 50) => (s.length > n ? s.slice(0, n) + "…" : s);
    const lines = [
      `\n  CONCEPT DRIFT (string-level) — ${out.target} vs the brand canon\n  ${"─".repeat(58)}`,
      `  ${out.coverage}% of ${out.canon} canon messages represented · ${out.offMessage.length}/${out.surface} surface strings off-message · ${out.mode}`,
      `\n  CANON MESSAGES → best surface match`,
      ...out.messages.map((m) => `     ${m.represented ? "✓" : "✗"} "${trunc(m.value)}"  (${m.score.toFixed(2)})${m.represented ? `  ← "${trunc(m.match ?? "", 38)}"` : "   — MISSING / drifted"}`),
      ...(out.offMessage.length ? [`\n  OFF-MESSAGE — surface strings matching no canon message`, ...out.offMessage.slice(0, 10).map((s) => `     · "${trunc(s)}"`)] : []),
      `\n  signal, not a gate. Strings are the unit (like translation): does each canon message land, what's off-message?\n`,
    ];
    return lines.map((l) => l + "\n").join("");
  },
});

export const registry = { audit: auditVerb, extract: extractVerb, scan: scanVerb, "concept-drift": conceptDriftVerb };

// Deterministic tests — no network, no key. Verifies the Anthropic path's request
// shape + response parsing (the live call itself is a keyed run, not tested here).
import assert from "node:assert/strict";
import { buildRequest, parseResponse } from "./anthropic.mjs";
import { aiIsms, overclaims, spellCheck, proofread, readability, registryDrift, vocabFromToolset } from "./prose.mjs";
import { valeLint, valeEnabled } from "./vale.mjs";
import { textlintEnabled, textlintLint } from "./textlint.mjs";
import { auditVerb, extractVerb, registry } from "./verbs.mjs";
import { toMcpToolset, toMcpTool, parseArgs } from "@bounded-systems/verbspec";

// request shape
const req = buildRequest({ type: "headline", value: "Hello world", grounding: ["fact-a", "fact-b"] });
assert.equal(req.tool_choice.name, "report", "forces the report tool (structured output)");
assert.ok(req.tools[0].input_schema.required.includes("score"), "schema requires score");
assert.ok(req.tools[0].input_schema.required.includes("findings"), "schema requires findings");
// The tool is single-sourced from a VerbSpec (anthropic.mjs, projected via toAnthropicTool);
// pin the exact projected schema so a verbspec/zod bump can't silently drift the contract
// (no $schema pointer; integer 0..10; string[]; additionalProperties:false).
assert.deepEqual(req.tools[0].input_schema, {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 10, description: "0 = unusable, 10 = excellent for its type." },
    findings: { type: "array", items: { type: "string" }, description: "Concrete, actionable problems. Empty if none." },
  },
  required: ["score", "findings"],
  additionalProperties: false,
}, "report tool projects to the pinned Anthropic contract");
assert.ok(req.system.includes("fact-a") && req.system.includes("fact-b"), "grounding enforced in system prompt");
assert.equal(req.messages[0].content, "Hello world", "audits the given copy");

// response parsing
const ok = parseResponse({ content: [{ type: "tool_use", input: { score: 7, findings: ["x"] } }] });
assert.equal(ok.score, 7);
assert.deepEqual(ok.findings, ["x"]);
assert.throws(() => parseResponse({ content: [{ type: "text", text: "no tool" }] }), /no tool_use/, "rejects a non-tool response");

console.log("✓ anthropic path verified — request shape + response parsing (no live call)");

// Prose checks now return { level, msg }. Helper: does any finding's msg match?
const hits = (findings, re) => findings.some((f) => re.test(f.msg));

// ── prose: the { level, msg } contract ──────────────────────────────────────────
const sample = aiIsms("It isn't a process — it's a door.");
assert.ok(sample.every((f) => f.msg && ["error", "warn", "suggestion"].includes(f.level)), "findings carry { level, msg }");
assert.ok(hits(aiIsms("As an AI language model, I can't help."), /chatbot|refusal/) , "data-driven error rule fires");
assert.ok(aiIsms("As an AI language model, I can't help.").some((f) => f.level === "error"), "chatbot artifact is error-level");

// ── prose: AI-isms (cold-read rule 4) ──────────────────────────────────────────
assert.ok(hits(sample, /antithesis/), "catches \"it isn't X — it's Y\"");
assert.ok(hits(aiIsms("Authoring is the easy part."), /easy.*part/i), "catches \"the easy part\" framing");
assert.ok(hits(aiIsms("Fast, simple, and reliable."), /rule-of-three/), "catches rule-of-three triad");
assert.ok(hits(aiIsms("We leverage a robust, seamless platform."), /filler/), "catches buzzword filler");
assert.ok(hits(aiIsms("Built it — shipped it — loved it — done."), /em-dash/), "catches em-dash cadence (3+)");
assert.ok(hits(aiIsms("It reaches past it — touching files, running a command, doing something else."), /tricolon/), "catches gerund tricolon");
assert.equal(aiIsms("The boundary an agent acts through").length, 0, "clean copy → no ai-isms");
assert.equal(aiIsms("A capability model — the core idea — applied here.").filter((f) => /em-dash/.test(f.msg)).length, 0, "a single parenthetical em-dash pair is fine");

// ── prose: overclaims (cold-read rule 5 / Lane C honesty) ───────────────────────
assert.ok(hits(overclaims("Secures every privileged effect."), /every/), "flags the \"every privileged effect\" coverage overclaim");
assert.ok(overclaims("Guaranteed to work.").length >= 1, "flags 'guaranteed'");
assert.equal(overclaims("No ambient authority required.").length, 0, "scoped copy → no overclaim");
assert.equal(overclaims("doing something you never asked for").length, 0, "ordinary 'never' (no coverage term) is not an overclaim");
assert.equal(overclaims("never the credential behind it").length, 0, "ordinary 'never' (no coverage term) is not an overclaim");

// ── prose: proofread ("was this proof read?") ───────────────────────────────────
assert.ok(hits(proofread("the the door"), /doubled word/), "catches doubled word");
assert.ok(hits(proofread("drawn at the door,not the process"), /after comma/), "catches missing space after comma");
assert.ok(hits(proofread("Bounded authority !"), /space before/), "catches space before punctuation");
assert.ok(hits(proofread("It’s a \"gem\""), /mixed/), "catches mixed straight + curly quotes");
assert.equal(proofread("A clean, well-written line.").length, 0, "clean copy → no proofread flags");
assert.equal(spellCheck("It isn't broken and we're fine").length, 0, "contractions aren't misspellings");

// ── prose: readability ("why am I reading this?") ───────────────────────────────
assert.ok(hits(readability(("word ".repeat(30)).trim(), "body"), /long sentence/), "catches over-long sentence");
assert.equal(readability("Authority drawn at the door.", "body").length, 0, "short, plain copy → no readability flag");

// ── voice-safe levels (downstream note: intentional em-dash voice must not gate) ─
assert.equal(aiIsms("It isn't a process — it's a door.").find((f) => /antithesis/.test(f.msg)).level, "suggestion", "em-dash antithesis is suggestion, not warn");
assert.equal(aiIsms("Built it — shipped it — loved it — done.").find((f) => /em-dash/.test(f.msg)).level, "suggestion", "em-dash cadence is suggestion, not warn");

// ── optional Vale provider (opt-in via AUDIT_VALE) ──────────────────────────────
assert.equal(valeEnabled(), false, "vale provider is off unless AUDIT_VALE is set");
assert.deepEqual(valeLint("anything"), [], "vale provider is a no-op when off / vale absent");

// ── optional textlint provider (opt-in via AUDIT_TEXTLINT) ──────────────────────
assert.equal(textlintEnabled(), false, "textlint provider is off unless AUDIT_TEXTLINT is set");
assert.deepEqual(await textlintLint("anything"), [], "textlint provider is a no-op when off");

// ── registry-aware drift check (issue #22, Direction 2) ─────────────────────────
// Vocab is built from the projected MCP tool schema (#27) — { name, inputSchema } — not Zod internals.
const minToolset = [{ name: "audit", inputSchema: { properties: { catalog: {}, store: { enum: ["fs", "cas", "socket"] } } } }];
const minVocab = vocabFromToolset(minToolset);
assert.equal(registryDrift("Clean headline copy.", "headline", minVocab).length, 0, "no flag refs → no drift findings");
assert.equal(registryDrift("Run `string-audit audit` to check.", "body", minVocab).length, 0, "known bin+verb pair → no drift");
assert.ok(registryDrift("Run `string-audit analyze` to scan.", "body", minVocab).some((f) => f.level === "error" && /analyze/.test(f.msg)), "unknown verb → error");
assert.ok(registryDrift("Pass --store for the backend.", "body", minVocab).length === 0, "known --flag → no drift");
assert.ok(registryDrift("Pass --backend for storage.", "body", minVocab).some((f) => f.level === "error" && /backend/.test(f.msg)), "unknown --flag → error");
assert.ok(registryDrift("Use STORE=redis for the backend.", "body", minVocab).some((f) => f.level === "error" && /redis/.test(f.msg)), "invalid enum value → error");
assert.ok(registryDrift("Use STORE=socket for the backend.", "body", minVocab).length === 0, "valid enum value → no drift");
assert.equal(registryDrift("Run `string-audit audit` now.", "cta", minVocab).length, 0, "cta type is skipped (not tool-doc copy)");
assert.equal(registryDrift(null, "body", null).length, 0, "no vocab → graceful no-op");

// #27 — vocab from the REAL projected registry (not Zod internals): a verbspec/zod bump
// that breaks the MCP projection fails HERE, instead of silently false-positiving valid flags.
const realVocab = vocabFromToolset(Object.values(registry).map((vb) => toMcpTool(vb)));
assert.ok(realVocab.flags.has("catalog") && realVocab.flags.has("store"), "real registry projects its flags");
assert.ok(realVocab.verbIds.has("audit") && realVocab.verbIds.has("extract"), "real registry projects its verb ids");
assert.equal(registryDrift("Pass --catalog and --store to audit.", "body", realVocab).length, 0, "valid registry flags never false-positive");
assert.equal(registryDrift("Pass --catalog now.", "body", vocabFromToolset([])).length, 0, "degraded vocab (empty projection) no-ops — no false errors");

console.log("✓ prose checks verified — { level, msg } + ai-isms + overclaims + proofread + readability + vale gate + registry-drift");

// ── verbspec surfaces: audit + extract as VerbSpecs → CLI + MCP (verbs.mjs) ──────
const toolset = toMcpToolset(registry);
assert.deepEqual(toolset.map((t) => t.name).sort(), ["audit", "extract"], "registry projects to the audit + extract MCP toolset");
assert.ok(toMcpTool(extractVerb).inputSchema.required.includes("file"), "extract MCP tool requires the file argument");
assert.ok(!toMcpTool(auditVerb).inputSchema.required, "audit MCP tool has no required args (all env-defaulted flags)");

// CLI projection: parseArgs maps the file positional + flags, validated by the Zod input.
const exInput = parseArgs(extractVerb, ["samples/page.html", "--catalog", "vendor/brand/content/strings.json"]);
assert.equal(exInput.file, "samples/page.html", "file positional parsed");
assert.equal(exInput.catalog, "vendor/brand/content/strings.json", "--catalog flag parsed");

// extract.run is a pure read → structured `output` (the shape MCP/agents consume); the CLI
// view is just render(output).
const ex = extractVerb.run({ file: "samples/page.html" });
assert.equal(ex.file, "page.html");
assert.ok(ex.coverage >= 0 && ex.coverage <= 100, "coverage is a percent");
assert.ok(ex.uncovered.every((u) => u.symbol.startsWith("surface.")), "each uncovered string carries a proposed symbol");
assert.ok(Array.isArray(ex.unused), "unused catalog symbols listed");

console.log("✓ verbspec surfaces verified — audit/extract VerbSpecs → CLI parse + MCP toolset + structured output");

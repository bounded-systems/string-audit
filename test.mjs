// Deterministic tests — no network, no key. Verifies the Anthropic path's request
// shape + response parsing (the live call itself is a keyed run, not tested here).
import assert from "node:assert/strict";
import { buildRequest, parseResponse } from "./anthropic.mjs";
import { aiIsms, overclaims, spellCheck, proofread, readability } from "./prose.mjs";

// request shape
const req = buildRequest({ type: "headline", value: "Hello world", grounding: ["fact-a", "fact-b"] });
assert.equal(req.tool_choice.name, "report", "forces the report tool (structured output)");
assert.ok(req.tools[0].input_schema.required.includes("score"), "schema requires score");
assert.ok(req.tools[0].input_schema.required.includes("findings"), "schema requires findings");
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
const sample = aiIsms("It isn't a frame — it's a window.");
assert.ok(sample.every((f) => f.msg && ["error", "warn", "suggestion"].includes(f.level)), "findings carry { level, msg }");
assert.ok(hits(aiIsms("As an AI language model, I can't help."), /chatbot|refusal/) , "data-driven error rule fires");
assert.ok(aiIsms("As an AI language model, I can't help.").some((f) => f.level === "error"), "chatbot artifact is error-level");

// ── prose: AI-isms (cold-read rule 4) ──────────────────────────────────────────
assert.ok(hits(sample, /antithesis/), "catches \"it isn't X — it's Y\"");
assert.ok(hits(aiIsms("Setup is the easy part."), /easy.*part/i), "catches \"the easy part\" framing");
assert.ok(hits(aiIsms("Fast, simple, and reliable."), /rule-of-three/), "catches rule-of-three triad");
assert.ok(hits(aiIsms("We leverage a robust, seamless platform."), /filler/), "catches buzzword filler");
assert.ok(hits(aiIsms("Built it — shipped it — loved it — done."), /em-dash/), "catches em-dash cadence (3+)");
assert.ok(hits(aiIsms("It reaches past it — touching files, running a command, doing something else."), /tricolon/), "catches gerund tricolon");
assert.equal(aiIsms("The frame that fills itself with photos").length, 0, "clean copy → no ai-isms");
assert.equal(aiIsms("A capability model — the core idea — applied here.").filter((f) => /em-dash/.test(f.msg)).length, 0, "a single parenthetical em-dash pair is fine");

// ── prose: overclaims (cold-read rule 5 / Lane C honesty) ───────────────────────
assert.ok(hits(overclaims("Secures every privileged effect."), /every/), "flags the \"every privileged effect\" coverage overclaim");
assert.ok(overclaims("Guaranteed to work.").length >= 1, "flags 'guaranteed'");
assert.equal(overclaims("No subscription required.").length, 0, "scoped copy → no overclaim");
assert.equal(overclaims("doing something you never asked for").length, 0, "ordinary 'never' (no coverage term) is not an overclaim");
assert.equal(overclaims("never the credential behind it").length, 0, "ordinary 'never' (no coverage term) is not an overclaim");

// ── prose: proofread ("was this proof read?") ───────────────────────────────────
assert.ok(hits(proofread("the the frame"), /doubled word/), "catches doubled word");
assert.ok(hits(proofread("photos by text,email or web"), /after comma/), "catches missing space after comma");
assert.ok(hits(proofread("Great frame !"), /space before/), "catches space before punctuation");
assert.ok(hits(proofread("It’s a \"gem\""), /mixed/), "catches mixed straight + curly quotes");
assert.equal(proofread("A clean, well-written line.").length, 0, "clean copy → no proofread flags");
assert.equal(spellCheck("It isn't broken and we're fine").length, 0, "contractions aren't misspellings");

// ── prose: readability ("why am I reading this?") ───────────────────────────────
assert.ok(hits(readability(("word ".repeat(30)).trim(), "body"), /long sentence/), "catches over-long sentence");
assert.equal(readability("Shows photos sent by text.", "body").length, 0, "short, plain copy → no readability flag");

console.log("✓ prose checks verified — { level, msg } + ai-isms + overclaims + proofread + readability");

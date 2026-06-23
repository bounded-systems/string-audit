// Deterministic tests — no network, no key. Verifies the Anthropic path's request
// shape + response parsing (the live call itself is a keyed run, not tested here).
import assert from "node:assert/strict";
import { buildRequest, parseResponse } from "./anthropic.mjs";
import { aiIsms, overclaims } from "./prose.mjs";

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

// ── prose: AI-isms (cold-read rule 4) ──────────────────────────────────────────
assert.ok(aiIsms("It isn't a frame — it's a window.").some((f) => /antithesis/.test(f)), "catches \"it isn't X — it's Y\"");
assert.ok(aiIsms("Setup is the easy part.").some((f) => /easy.*part/i.test(f)), "catches \"the easy part\" framing");
assert.ok(aiIsms("Fast, simple, and reliable.").some((f) => /rule-of-three/.test(f)), "catches rule-of-three triad");
assert.ok(aiIsms("We leverage a robust, seamless platform.").some((f) => /filler/.test(f)), "catches buzzword filler");
assert.ok(aiIsms("Built it — shipped it — loved it — done.").some((f) => /em-dash/.test(f)), "catches em-dash cadence (3+)");
assert.ok(aiIsms("It reaches past it — touching files, running a command, doing something else.").some((f) => /tricolon/.test(f)), "catches gerund tricolon (rule-of-three)");
assert.equal(aiIsms("The frame that fills itself with photos").length, 0, "clean copy → no ai-isms");
assert.equal(aiIsms("A capability model — the core idea — applied here.").filter((f) => /em-dash/.test(f)).length, 0, "a single parenthetical em-dash pair is fine");

// ── prose: overclaims (cold-read rule 5 / Lane C honesty) ───────────────────────
assert.ok(overclaims("Secures every privileged effect.").some((f) => /every/.test(f)), "flags the \"every privileged effect\" coverage overclaim");
assert.ok(overclaims("Guaranteed to work.").length >= 1, "flags 'guaranteed'");
assert.equal(overclaims("No subscription required.").length, 0, "scoped copy → no overclaim");
assert.equal(overclaims("doing something you never asked for").length, 0, "ordinary 'never' (no coverage term) is not an overclaim");
assert.equal(overclaims("never the credential behind it").length, 0, "ordinary 'never' (no coverage term) is not an overclaim");

console.log("✓ prose checks verified — ai-isms + overclaims");

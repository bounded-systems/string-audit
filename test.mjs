// Deterministic tests — no network, no key. Verifies the Anthropic path's request
// shape + response parsing (the live call itself is a keyed run, not tested here).
import assert from "node:assert/strict";
import { buildRequest, parseResponse } from "./anthropic.mjs";

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

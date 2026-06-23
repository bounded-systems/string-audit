// Real Anthropic auditor — runs on a cache MISS when ANTHROPIC_API_KEY is set.
// Structured output via tool-use (the model must return {score, findings}), a
// cost-aware default model, and grounding enforced in the system prompt so the
// auditor flags ungrounded claims instead of inventing facts. The HTTP call is
// dep-free (native fetch); the report-tool schema is projected from a verbspec VerbSpec.
import { z } from "zod";
import { defineVerb, toAnthropicTool } from "@bounded-systems/verbspec";

const MODEL = process.env.AUDIT_MODEL || "claude-haiku-4-5-20251001";

// The `report` tool is authored ONCE as a VerbSpec and projected to the Anthropic
// tool surface (toAnthropicTool) — the same typed contract a CLI / MCP / OpenAPI
// projection reads, so the structured-output schema can't drift from them. The model
// fills `report` with {score, findings}; there is no server-side run (it's a tool-use
// surface), so output/run are vestigial. parseResponse reads back tool_use.input.
export const reportVerb = defineVerb({
  id: "report",
  summary: "Report the audit result for one copy string.",
  actor: "audit",
  input: z.object({
    score: z.number().int().min(0).max(10).describe("0 = unusable, 10 = excellent for its type."),
    findings: z.array(z.string()).describe("Concrete, actionable problems. Empty if none."),
  }),
  output: z.object({ ok: z.boolean() }).describe("unused — `report` is a tool-use surface, not a runnable verb"),
  run: () => ({ ok: true }),
});

// Project to the Anthropic tool definition. z.toJSONSchema stamps a `$schema` draft
// pointer on the input schema; strip it so the wire payload stays byte-for-byte what
// the hand-written REPORT_TOOL sent (the Messages API ignores it either way).
const REPORT_TOOL = (() => {
  const tool = toAnthropicTool(reportVerb);
  const { $schema, ...input_schema } = tool.input_schema;
  return { ...tool, input_schema };
})();

const system = (type, grounding) =>
  `You audit a single "${type}" copy string for a product.
Judge it only for its type (a headline as a headline, a CTA as a CTA, etc.).
GROUNDING — the ONLY facts you may treat as true: ${grounding.join("; ") || "(none provided)"}.
Never assert a number, rating, spec, or certification that is not in GROUNDING; if the
copy makes an ungrounded factual claim, that is a finding, not something to accept.
Flag AI-isms — the formulaic tells of machine-written copy: "it isn't X — it's Y"
antithesis, "the easy part … the hard part", rule-of-three triads, buzzword filler
(delve, seamless, leverage, unlock, robust, elevate), and rhetorical teaser fragments.
Flag absolute overclaims ("every", "always", "guaranteed", "100%") unless GROUNDING backs them.
Flag proofreading defects (typos, doubled words, stray/missing spaces, mixed quote styles)
and copy that's hard to read (over-long or dense sentences a reader would bounce off).
Call the report tool with a score and concrete findings.`;

// Pure: build the Messages API request body (testable without a network call).
export function buildRequest({ type, value, grounding = [] }) {
  return {
    model: MODEL,
    max_tokens: 1024,
    system: system(type, grounding),
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: "report" },
    messages: [{ role: "user", content: value }],
  };
}

// Pure: parse a Messages API response into {score, findings} (testable).
export function parseResponse(data) {
  const tool = (data.content || []).find((c) => c.type === "tool_use");
  if (!tool) throw new Error("no tool_use in response");
  return { score: tool.input.score, findings: tool.input.findings, model: MODEL };
}

export async function auditWithAnthropic(input) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildRequest(input)),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseResponse(await res.json());
}

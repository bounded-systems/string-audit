// Real Anthropic auditor — runs on a cache MISS when ANTHROPIC_API_KEY is set.
// Structured output via tool-use (the model must return {score, findings}), a
// cost-aware default model, and grounding enforced in the system prompt so the
// auditor flags ungrounded claims instead of inventing facts. Zero-dep (fetch).
const MODEL = process.env.AUDIT_MODEL || "claude-haiku-4-5-20251001";

const REPORT_TOOL = {
  name: "report",
  description: "Report the audit result for one copy string.",
  input_schema: {
    type: "object",
    required: ["score", "findings"],
    additionalProperties: false,
    properties: {
      score: { type: "integer", minimum: 0, maximum: 10, description: "0 = unusable, 10 = excellent for its type." },
      findings: { type: "array", items: { type: "string" }, description: "Concrete, actionable problems. Empty if none." },
    },
  },
};

const system = (type, grounding) =>
  `You audit a single "${type}" copy string for a product.
Judge it only for its type (a headline as a headline, a CTA as a CTA, etc.).
GROUNDING — the ONLY facts you may treat as true: ${grounding.join("; ") || "(none provided)"}.
Never assert a number, rating, spec, or certification that is not in GROUNDING; if the
copy makes an ungrounded factual claim, that is a finding, not something to accept.
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

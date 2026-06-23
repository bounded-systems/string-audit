#!/usr/bin/env node
// SPIKE (issue #27) — build the registry-drift vocab from verbspec's PUBLIC projection
// instead of reaching into Zod internals.
//
// Production `vocabFromRegistry` (prose.mjs) reads `verb.input._def.shape()` and
// `field._def.entries|values` inside a swallowing try/catch. A zod/verbspec bump that
// changes those internals silently degrades the vocab to {help,version} — and since an
// unknown `--flag` is an `error`, valid copy (`--catalog`, `--store`) then false-positives
// as drift and breaks the gate. This builds the vocab from `toMcpToolset(registry)` /
// `toMcpTool(verb).inputSchema` instead — JSON Schema, the stable surface test.mjs already
// pins — so the contract can't drift. Plus a fail-safe: a degraded vocab → no findings.
//
//   node spikes/vocab-from-schema.mjs
import { registryDrift } from "../prose.mjs";

// Vocab from a projected MCP toolset (what `toMcpToolset(registry)` returns):
// [{ name, inputSchema: { properties, ... } }]. name → verb id; properties keys → flags;
// properties[x].enum → enum values. No Zod/_def access anywhere.
export function vocabFromToolset(toolset, bins = ["string-audit", "string-audit-mcp"]) {
  const verbIds = new Set(toolset.map((t) => t.name));
  const flags = new Set(["help", "version"]);
  const enums = {};
  for (const t of toolset) {
    for (const [name, prop] of Object.entries(t.inputSchema?.properties ?? {})) {
      flags.add(name.toLowerCase());
      if (Array.isArray(prop?.enum)) enums[name.toLowerCase()] = new Set(prop.enum.map((x) => String(x).toLowerCase()));
    }
  }
  return { verbIds, flags, enums, bins: new Set(bins) };
}

// Fail-safe the production check should adopt: a vocab with only the globals means
// extraction failed — return [] rather than flag every valid --flag as drift.
export const vocabIsDegraded = (vocab) => !vocab || vocab.flags.size <= 2;

if (import.meta.url === `file://${process.argv[1]}`) {
  // Stand-in for `toMcpToolset(registry)` — audit + extract projected to JSON Schema.
  const toolset = [
    { name: "audit", inputSchema: { properties: { catalog: {}, grounding: {}, store: { enum: ["fs", "cas", "socket"] }, version: {}, vale: {} } } },
    { name: "extract", inputSchema: { properties: { file: {}, catalog: {} } } },
  ];
  const vocab = vocabFromToolset(toolset);
  console.log(`\n  VOCAB FROM PROJECTED SCHEMA (no _def access)\n  ${"─".repeat(48)}`);
  console.log("  verbs:", [...vocab.verbIds].join(", "));
  console.log("  flags:", [...vocab.flags].sort().join(", "));
  console.log("  store:", [...vocab.enums.store].join("|"));

  for (const s of [
    "Run with --store=cas and --catalog.",                                 // clean
    "Use the --cache flag; set STORE=redis; run `string-audit lint`.",      // 3× drift
  ]) {
    console.log(`\n  “${s}”`);
    const f = registryDrift(s, "body", vocab);
    f.length ? f.forEach((x) => console.log("    ✗ " + x.msg)) : console.log("    (no drift)");
  }

  // Fail-safe: a degraded vocab must NOT false-positive valid flags.
  const degraded = { verbIds: new Set(), flags: new Set(["help", "version"]), enums: {}, bins: new Set() };
  console.log(`\n  degraded vocab guard: vocabIsDegraded → ${vocabIsDegraded(degraded)} (production should no-op here)`);
  console.log();
}

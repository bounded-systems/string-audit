#!/usr/bin/env node
// `concept-drift` — has a surface drifted from the canonical brand messages? Per-message
// coverage vs the registry core (the `concept-drift` verb / `string-audit-concept-drift`
// bin, verbs.mjs, projected to a CLI via verbspec). Tiered matching, best-available:
// embeddings (opt-in EMBED_API_KEY, OpenAI-compatible) → token overlap (stemmed) → exact.
//   node concept-drift.mjs [target.json|target.html]
//   node extract.mjs page.html --emit > t.json && node concept-drift.mjs t.json
//   EMBED_API_KEY=… node concept-drift.mjs           # tier 1 (semantic)
//   node concept-drift.mjs --help
import { parseArgs, toHelp } from "@bounded-systems/verbspec";
import { conceptDriftVerb } from "./verbs.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  // single-verb bin: drop verbspec's `<bin> <verb>` prefix.
  console.log(toHelp(conceptDriftVerb, "node concept-drift.mjs").replace("node concept-drift.mjs concept-drift", "node concept-drift.mjs"));
  process.exit(0);
}
const input = parseArgs(conceptDriftVerb, argv);
const output = await conceptDriftVerb.run(input);
process.stdout.write(conceptDriftVerb.render(output, input));

#!/usr/bin/env node
// Token extraction + coverage (#2/#3) — the `extract` verb (verbs.mjs) projected to a
// CLI via verbspec. Scan an HTML surface for hardcoded visible strings, infer a type,
// and reconcile against the catalog: covered / uncovered (propose a symbol) / unused.
//   node extract.mjs <surface.html>
//   node extract.mjs --help
import { parseArgs, toHelp } from "@bounded-systems/verbspec";
import { extractVerb } from "./verbs.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  // single-verb bin: drop verbspec's `<bin> <verb>` prefix (no `extract` subcommand here).
  console.log(toHelp(extractVerb, "node extract.mjs").replace("node extract.mjs extract", "node extract.mjs"));
  process.exit(0);
}
if (!argv.some((a) => !a.startsWith("--"))) {
  console.error("usage: node extract.mjs <surface.html>");
  process.exit(2);
}
const output = extractVerb.run(parseArgs(extractVerb, argv));
process.stdout.write(extractVerb.render(output));

#!/usr/bin/env node
// Token extraction + coverage (#2/#3) — the `extract` verb (verbs.mjs) projected to a
// CLI via verbspec. Scan an HTML surface for hardcoded visible strings, infer a type,
// and reconcile against the catalog: covered / uncovered (propose a symbol) / unused.
//   node extract.mjs <surface.html>                          # coverage report
//   node extract.mjs <surface.html> --emit > strings.json    # extract a DTCG catalog
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
const input = parseArgs(extractVerb, argv);
const output = await extractVerb.run(input); // run may be sync or async per the VerbSpec type
if (input.emit) {
  // a DTCG content/strings.json you can redirect into a catalog and refine.
  const doc = { "$description": `Extracted content tokens — ${output.file} (${output.surface} surface strings). Seed/merge into a content/strings.json. ($type drives string-audit's typed audits; drop it for the brand DTCG schema.)`, ...output.tokens };
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
} else {
  process.stdout.write(extractVerb.render(output, input));
}

#!/usr/bin/env node
// `scan` — extract every hardcoded static string from source (i18n-style), then type +
// Zod-validate the keepers (the copy that should be symbols). The `string-audit-scan` bin
// / `scan` verb (verbs.mjs) projected to a CLI via verbspec. AST extraction via optional
// `acorn`; the per-type Zod contracts are shared with `audit` (types.mjs).
//   node scan.mjs [dir]                                  # report
//   node scan.mjs [dir] --emit > content/strings.json    # DTCG catalog of the keepers
//   node scan.mjs --help
import { parseArgs, toHelp } from "@bounded-systems/verbspec";
import { scanVerb } from "./verbs.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  // single-verb bin: drop verbspec's `<bin> <verb>` prefix (no `scan` subcommand here).
  console.log(toHelp(scanVerb, "node scan.mjs").replace("node scan.mjs scan", "node scan.mjs"));
  process.exit(0);
}
const input = parseArgs(scanVerb, argv);
const output = await scanVerb.run(input);
if (input.emit) {
  const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 5).join("-");
  const doc = { "$description": `Keeper strings scanned from ${output.dir} (${output.keepers.length} of ${output.literals} literals, ${output.parser}). Typed; review + adopt as content tokens.` };
  for (const k of output.keepers) doc[`scan.${k.type}.${slug(k.value)}`] = { "$value": k.value, "$type": k.type, "$description": `from ${k.file}${k.valid ? "" : ` (⚠ ${k.error})`}` };
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
} else {
  process.stdout.write(scanVerb.render(output, input));
}

#!/usr/bin/env node
// `string-audit` — the `audit` verb (verbs.mjs) projected to a CLI via verbspec.
// Same env knobs as ever (CATALOG, GROUNDING, STORE, ROOM/SOCK, AUDIT_VERSION,
// AUDIT_MODEL, AUDIT_VALE, ANTHROPIC_API_KEY); --catalog/--grounding/--store/--version/
// --vale flags override the runtime-read ones. Re-running is free for unchanged symbols.
//
//   node audit.mjs                 # audit; second run = 0 calls (all cached)
//   node audit.mjs --store=cas     # back the cache with cas + anchored-chain
//   AUDIT_VERSION=2 node audit.mjs # bump to invalidate the whole cache intentionally
//   node audit.mjs --help
import { parseArgs, toHelp } from "@bounded-systems/verbspec";
import { auditVerb } from "./verbs.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  // single-verb bin: drop verbspec's `<bin> <verb>` prefix (no `audit` subcommand here).
  console.log(toHelp(auditVerb, "node audit.mjs").replace("node audit.mjs audit", "node audit.mjs"));
  process.exit(0);
}
const input = parseArgs(auditVerb, argv);
const output = await auditVerb.run(input);
process.stdout.write(auditVerb.render(output, input));

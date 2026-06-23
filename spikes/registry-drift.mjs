#!/usr/bin/env node
// SPIKE (issue #22, Direction 2) — registry-aware prose drift check.
//
// string-audit owns a typed verbspec registry (verbs.mjs): the verbs, their flags, and
// enum-valued flags. Copy that references a `--flag` or an enum value that ISN'T in the
// registry has drifted from the actual surface (renamed / removed / typo'd) — a
// correctness defect, like an ungrounded claim. No off-the-shelf prose linter catches
// this; it needs OUR domain model.
//
// Design: the check is PURE and ZERO-DEP — it takes a `vocab`, so it never imports
// verbspec/zod. Callers that already hold the registry (audit.mjs) build the vocab via
// vocabFromRegistry() and pass it in; this sandbox demo hands a plain stand-in. That keeps
// the spike runnable with no JSR install, and keeps the check independent of verbspec.
//
//   node spikes/registry-drift.mjs                         # demo on sample copy
//   node spikes/registry-drift.mjs "the --cache flag, STORE=redis"
//
// PROMOTED: vocabFromRegistry + registryDrift → prose.mjs (issue #22 follow-up to this spike).
// The spike remains as a zero-dep demo and as the origin memo for the production implementation.

// Build the drift vocabulary from a verbspec registry ({ id → VerbSpec }). Reads flag
// names from each verb's Zod input shape + enum options where present. Operates on the
// passed object only (no verbspec/zod import). Wire-up point — exercised in CI, where the
// real registry is importable; here it's unit-demoed against a registry-shaped stand-in.
export function vocabFromRegistry(registry) {
  const flags = new Set(["help", "version"]); // always-valid globals
  const enums = {};
  for (const verb of Object.values(registry)) {
    const shape = verb?.input?.shape ?? {};
    for (const [name, field] of Object.entries(shape)) {
      flags.add(name);
      const opts = field?.options ?? field?._def?.entries ?? field?._def?.values; // z.enum options (v4-ish)
      if (opts) enums[name] = new Set(Array.isArray(opts) ? opts : Object.values(opts));
    }
  }
  return { flags, enums };
}

const FLAG = /(?<![\w-])--([a-z][a-z0-9-]*)/gi; // a CLI flag reference (not a prose double-hyphen)
const enumRef = (name) => new RegExp(`\\b(?:--${name}[ =]|${name.toUpperCase()}=)([a-z][a-z0-9-]*)`, "gi");

// → [{ level: "error", msg }]  — drift is a correctness defect (same tier as UNGROUNDED).
export function registryDrift(value, vocab) {
  const out = [];
  const seen = new Set();
  for (const m of value.matchAll(FLAG)) {
    const flag = m[1].toLowerCase();
    if (!vocab.flags.has(flag) && !seen.has("f:" + flag)) {
      seen.add("f:" + flag);
      out.push({ level: "error", msg: `registry-drift: --${flag} is not a flag of any verb (renamed/removed/typo?)` });
    }
  }
  for (const [name, allowed] of Object.entries(vocab.enums || {})) {
    for (const m of value.matchAll(enumRef(name))) {
      const val = m[1].toLowerCase();
      if (!allowed.has(val) && !seen.has(`e:${name}:${val}`)) {
        seen.add(`e:${name}:${val}`);
        out.push({ level: "error", msg: `registry-drift: ${name}=${val} — not a valid value (${[...allowed].join("|")})` });
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Stand-in for string-audit's real registry vocab (verbs.mjs: audit + extract). In
  // production this is `vocabFromRegistry(registry)` — same shape, derived not hand-typed.
  const vocab = {
    flags: new Set(["help", "version", "catalog", "grounding", "store", "vale", "file"]),
    enums: { store: new Set(["fs", "cas", "socket"]) },
  };
  const samples = process.argv[2] ? [process.argv[2]] : [
    "Pass --catalog to point at your strings, then run with --store=cas.",            // clean
    "Use the --cache flag to reuse results and set STORE=redis for the backend.",     // drift ×2
    "Audit with --grounding facts.json; --vale folds in the Vale provider.",          // clean
  ];
  console.log(`\n  REGISTRY-DRIFT SPIKE — copy vs the verbspec registry\n  ${"─".repeat(52)}`);
  for (const s of samples) {
    console.log(`\n  "${s.slice(0, 64)}${s.length > 64 ? "…" : ""}"`);
    const f = registryDrift(s, vocab);
    if (!f.length) console.log("       (no drift)");
    for (const x of f) console.log(`       ✗ ${x.msg}`);
  }
  console.log();
}

// Optional textlint provider — fold in AST-based prose linting for teams that already
// use textlint, WITHOUT a hard dependency. Opt-in via AUDIT_TEXTLINT=1 (mirrors
// AUDIT_VALE=1). Returns the shared { level, msg } shape. Textlint is Node-native
// (no external binary, no egress for rules if installed locally) — same policy class
// as the JSR deps. Only the "optional" install path (npm install --include=optional)
// pulls it in; the default pipeline (`npm ci --omit=optional`) is unaffected.
//
// Why textlint over retext:
//   textlint: ESLint-for-prose, large rule ecosystem, programmatic API, autofix.
//   retext:   CST-based unified pipeline — better foundation for schema-aware analysis
//             (issue #22 Direction 2 spike), but heavier for rule-based linting.
// Both stay opt-in. textlint ships here as the first programmable prose provider.
//
// Bundled rules (require textlint + textlint-rule-write-good installed as optional deps):
//   textlint-rule-write-good — wraps write-good, same underlying engine as grammarCheck()
//                              but with sentence-level AST context for better precision.
//
//   AUDIT_TEXTLINT=1 node audit.mjs          # merge textlint findings into prose pass
//   node textlint.mjs "your copy string"     # provider smoke-test
export const textlintEnabled = () => !!process.env.AUDIT_TEXTLINT;

// Run textlint on a string via its programmatic API; map alerts to { level, msg }.
// Returns [] unless AUDIT_TEXTLINT is set AND textlint is installed.
export async function textlintLint(value) {
  if (!textlintEnabled()) return [];
  try {
    const { TextLintEngine } = await import("textlint");
    const engine = new TextLintEngine({ rules: { "write-good": true } });
    const results = await engine.executeOnText(value);
    const sev = (s) => s === 2 ? "error" : s === 1 ? "warn" : "suggestion";
    return results.flatMap((r) =>
      r.messages.map((m) => ({ level: sev(m.severity), msg: `textlint ${m.ruleId}: ${m.message}` })),
    ).slice(0, 4);
  } catch {
    return []; // textlint not installed or rule not found → silent no-op
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!textlintEnabled()) {
    console.log("  AUDIT_TEXTLINT not set — provider is off (grammarCheck() write-good stands in).");
    console.log("  enable: AUDIT_TEXTLINT=1 with textlint + textlint-rule-write-good installed.");
    console.log("  install: npm install --save-optional textlint textlint-rule-write-good");
  } else {
    const s = process.argv[2] || "In today's fast-paced world, we leverage a seamless, robust solution.";
    console.log(`  textlint findings for: "${s}"`);
    for (const f of await textlintLint(s)) console.log(`       [${f.level}] ${f.msg}`);
  }
}

// Optional Vale provider — fold in the far larger vale-signs-of-ai-writing corpus for
// teams that already run Vale, WITHOUT a hard dependency. Opt-in via AUDIT_VALE=1
// (mirrors how ANTHROPIC_API_KEY gates the LLM path) so a dev's local run can't diverge
// from CI just because `vale` happens to be on their PATH. Returns the shared
// { level, msg } shape. Note: `vale sync` needs egress (same policy class as the JSR
// deps) — which is why the in-house ai-tells.json port is the default.
//
//   AUDIT_VALE=1 node audit.mjs          # merge Vale's findings into the prose pass
//   node vale.mjs "your copy string"     # provider smoke-test
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const valeEnabled = () => !!process.env.AUDIT_VALE; // explicit opt-in, not presence

export function valeAvailable() {
  const r = spawnSync("vale", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

// Run Vale on a string; map its JSON alerts to our { level, msg }. Vale severities:
// error → error · warning → warn · suggestion → suggestion. A graceful no-op (returns [])
// unless AUDIT_VALE is set AND `vale` is installed.
export function valeLint(value) {
  if (!valeEnabled() || !valeAvailable()) return [];
  const dir = mkdtempSync(join(tmpdir(), "vale-"));
  const file = join(dir, "copy.md");
  try {
    writeFileSync(file, value + "\n");
    const r = spawnSync("vale", ["--output=JSON", file], { encoding: "utf8" });
    const data = JSON.parse(r.stdout || "{}");
    const map = { error: "error", warning: "warn", suggestion: "suggestion" };
    return Object.values(data).flat().map((a) => ({
      level: map[a.Severity] || "suggestion",
      msg: `vale ${a.Check}: ${a.Message}`,
    }));
  } catch {
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.AUDIT_VALE) {
    console.log("  AUDIT_VALE not set — provider is off (the in-house ai-tells.json checks stand in).");
    console.log("  enable: AUDIT_VALE=1, with `vale` installed (https://vale.sh) + vale-signs-of-ai-writing synced.");
  } else if (!valeAvailable()) {
    console.log("  AUDIT_VALE=1 but `vale` not on PATH — no-op. Install: https://vale.sh");
  } else {
    const s = process.argv[2] || "In today's fast-paced world, we leverage a seamless, robust solution.";
    console.log(`  vale findings for: “${s}”`);
    for (const f of valeLint(s)) console.log(`       [${f.level}] ${f.msg}`);
  }
}

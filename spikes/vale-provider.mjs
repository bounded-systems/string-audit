#!/usr/bin/env node
// SPIKE (issue #6) — optional Vale provider: shell out to the `vale` binary when it's
// installed, mirroring the deterministic-vs-anthropic provider split. Off by default and
// degrades gracefully: if `vale` isn't on PATH, valeAvailable() is false and we return []
// (the in-house checks remain the source of truth). This prototypes proposal #2 — fold
// Vale's far larger AI-tell corpus in for teams that already run it — WITHOUT taking a
// hard dependency. Note: `vale sync` pulls styles over the network; this repo's policy
// may block that, which is exactly why the in-house port (vale-rules.mjs) is the default.
//
//   node spikes/vale-provider.mjs "your copy string"
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function valeAvailable() {
  const r = spawnSync("vale", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

// Run Vale on a string; map its JSON alerts to our { level, msg } shape.
// Vale severities: error | warning | suggestion → error | warn | suggestion.
export function valeLint(value) {
  if (!valeAvailable()) return [];
  const dir = mkdtempSync(join(tmpdir(), "vale-spike-"));
  const file = join(dir, "copy.md");
  try {
    writeFileSync(file, value + "\n");
    const r = spawnSync("vale", ["--output=JSON", file], { encoding: "utf8" });
    const data = JSON.parse(r.stdout || "{}");
    const map = { error: "error", warning: "warn", suggestion: "suggestion" };
    return Object.values(data).flat().map((a) => ({
      level: map[a.Severity] || "suggestion",
      msg: `${a.Check}: ${a.Message}`,
    }));
  } catch {
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!valeAvailable()) {
    console.log("  vale not found on PATH — provider is a no-op (in-house checks stand in).");
    console.log("  install: https://vale.sh  ·  then `vale sync` with vale-signs-of-ai-writing in .vale.ini");
  } else {
    const s = process.argv[2] || "In today's fast-paced world, we leverage a seamless, robust solution.";
    console.log(`  vale findings for: “${s}”`);
    for (const f of valeLint(s)) console.log(`       [${f.level}] ${f.msg}`);
  }
}

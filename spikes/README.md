# spikes/ — exploratory prototypes (not wired into the pipeline)

Throwaway-ish experiments toward [issue #6](https://github.com/bounded-systems/string-audit/issues/6)
("adopt Vale's AI-tell rules instead of hand-maintaining the lexicon"). Nothing here is
imported by `audit.mjs` / `test.mjs`, so it can't affect CI or the shipped checks. Each is
zero-dep and runnable on its own.

| Spike | What it explores | Run |
|---|---|---|
| `ai-tells.json` | The AI-tell **rules as data** — patterns + lexicon, each carrying a severity `level` (error / warn / suggestion). Seeded from `vale-signs-of-ai-writing` + Wikipedia's *Signs of AI writing*. | — |
| `vale-rules.mjs` | Data-driven scan over `ai-tells.json` returning **structured `{ level, msg }`** findings — the "port the rules + first-class severity" direction (#6 proposals 1 & 3). | `node spikes/vale-rules.mjs` |
| `vale-provider.mjs` | **Optional** shell-out to the `vale` binary when installed, mapped to the same `{ level, msg }` shape; a graceful no-op otherwise (#6 proposal 2). | `node spikes/vale-provider.mjs` |

## The direction these point at

Today `prose.mjs` hard-codes patterns/lexicon and tiers are applied at render time in
`audit.mjs`. The spikes show a cleaner shape:

1. **Rules as data** (`ai-tells.json`) so the lexicon tracks the upstream corpus instead
   of living in code — `aiIsms()` would load from it.
2. **Severity as a first-class field** on every finding (`{ level, msg }`), so the render
   glyph (`✗`/`⚠`/`·`) is derived, not pattern-matched from message text.
3. **A pluggable provider seam** — in-house port by default (zero-dep, policy-safe),
   `vale` shell-out as an opt-in for teams that already run it — mirroring the existing
   deterministic-vs-anthropic split.

If we like this, the migration is: move `aiIsms`/`overclaims` to emit `{ level, msg }`,
back them with `ai-tells.json`, and let `audit.mjs` merge findings from whichever
providers are enabled. Kept as spikes until that refactor is greenlit.

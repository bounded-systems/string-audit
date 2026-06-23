# spikes/ — exploratory prototypes (not wired into the pipeline)

Throwaway-ish experiments toward [issue #6](https://github.com/bounded-systems/string-audit/issues/6)
("adopt Vale's AI-tell rules instead of hand-maintaining the lexicon"). Nothing here is
imported by `audit.mjs` / `test.mjs`, so it can't affect CI or the shipped checks. Each is
zero-dep and runnable on its own.

> **Promoted (all three proposals landed):** the data-driven path is in production —
> `aiIsms()`/`overclaims()` and the rest of `prose.mjs` emit first-class `{ level, msg }`,
> backed by the canonical [`../ai-tells.json`](../ai-tells.json) (#6 1 & 3). The optional
> Vale provider now lives at [`../vale.mjs`](../vale.mjs), gated on `AUDIT_VALE=1` and wired
> into `audit.mjs` (#6 2). Only the demo below remains here.

| Spike | What it explores | Run |
|---|---|---|
| `vale-rules.mjs` | Data-driven scan over the (now root) `ai-tells.json` returning **structured `{ level, msg }`** findings — the shape `prose.mjs` adopted. (Production reads the same file; this is just a standalone demo.) | `node spikes/vale-rules.mjs` |
| ~~`registry-drift.mjs`~~ | **Promoted → `prose.mjs`** ([#22]). `registryDrift(value, vocab)` + `vocabFromSchemas(schemas)` now ship; `verbs.mjs` builds the vocab from the projected verb schemas (`toMcpTool(...).inputSchema`) and runs it in the prose pass as an `error`-level gate. | (in production) |

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

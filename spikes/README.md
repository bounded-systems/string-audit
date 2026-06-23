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
| `registry-drift.mjs` | **[#22] schema-aware drift check** — flags copy referencing a `--flag` or enum value that isn't in the verbspec registry (`verbs.mjs`): renamed/removed/typo'd surface = a correctness `error`. Pure + zero-dep (takes a `vocab`); `vocabFromRegistry(registry)` is the wire-up adapter. The differentiated check no off-the-shelf linter does. | `node spikes/registry-drift.mjs` |
| `concept-drift.mjs` | **[#28] concept drift** — the softer cousin: has a surface's copy drifted from the canonical brand *concepts* (the registry core's salient terms)? Scores concept coverage, flags **missing** (drifted-away) + **novel** (off-message) terms. A *signal*, not a gate. **Stem-aware** via the optional `stemmer` dep (Porter; `agents`≈`agent`, `capabilities`≈`capability`), graceful lexical fallback if absent; **embeddings** (synonym/semantic) is the next iteration. Pairs with `extract --emit`. | `node spikes/concept-drift.mjs` |

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

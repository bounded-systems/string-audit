# @bounded-systems/string-audit

A **cost-aware, grounded content auditor**. Every string is a named, *typed* symbol;
audits are scoped by type; results are **content-hash cached** so only changed copy
pays for the (expensive) LLM call. Rewrites can't invent facts — claims are checked
against a grounding source, not fabricated.

```sh
node audit.mjs                       # deterministic, offline, free
ANTHROPIC_API_KEY=… node audit.mjs   # real audits — only on cache-misses
```

## One boundary, four properties
1. **Symbols, not blobs** — `pdp.hero.headline → { type: "headline", value }`. The
   **type is the contract**; it decides which audits apply.
2. **Type-scoped audits** — `headline` → length/punch; `cta` → action-verb; `meta` →
   ≤160; `claim` → **grounding** (the "every claim proven" check).
3. **Content-addressed cache** — `key = sha256(auditVersion : type : value)`. Unchanged
   symbol → cache hit → skip the call. Only the diff since last run costs money; bump
   `AUDIT_VERSION` to invalidate intentionally. Gives `▲▼ vs previous run` for free.
4. **Grounded, not fabricated** — a `claim` may only assert facts in the grounding
   source; ungrounded numbers/ratings/specs are *flagged*, never rewritten as fact.

## Providers
- **deterministic** (default, offline) — local checks; reproducible; no key needed.
- **anthropic** (`anthropic.mjs`) — runs on a cache **miss** when `ANTHROPIC_API_KEY`
  is set. Structured output via tool-use (`{score, findings}`), cost-aware default
  model (`claude-haiku-4-5`, override with `AUDIT_MODEL`), grounding enforced in the
  system prompt.

## Copy hygiene — deterministic prose checks
Run on every symbol, every run (cheap, never cached):
- **spell** — modern wordlist ∪ `dictionary.txt` (brand terms).
- **grammar/style** — write-good (passive, wordiness, weasel words).
- **ai-isms** — the formulaic tells of machine-written copy: `it isn't X — it's Y`
  antithesis, `the easy part … the hard part`, rule-of-three triads, em-dash cadence,
  rhetorical teaser fragments, and buzzword filler (`delve`, `seamless`, `leverage`,
  `unlock`, `robust` …). Each finding names the tell so a human can rewrite it.
- **overclaims** — absolute, unprovable language (`every`, `always`, `guaranteed`,
  `100%`); scope the claim or link a source. The prose analogue of the grounding check.
- **overlap** — symbols whose copy is duplicated or near-duplicate.

The ai-ism and overclaim rules come from a cold read of the public copy ("AI-isms make
me want to die"; "never claim *every* privileged effect"). The keyed Anthropic auditor is
told the same rules, so the LLM path flags them too.

## Reuses the bounded-systems stack
| Need | Primitive |
|---|---|
| hash-keyed result cache | [`cas`](https://github.com/bounded-systems/cas) — bytes by SHA-256 |
| signed, lineage-tracked derivations | [`anchored-chain`](https://github.com/bounded-systems/anchored-chain) |
| typed symbol catalog + per-type assertions | [`brand/content`](https://github.com/bounded-systems/brand) |
| budget awareness | [`prx`](https://github.com/bounded-systems/prx) |

The local `.cache/` (SHA-256 keyed) is already a valid CAS; the `cas` package +
`anchored-chain` lineage drop in behind the same get/put on the miss path.

## Store backends (`STORE=`)
Same `get/put/has` port, three backings:
- **`fs`** (default) — content-addressed file cache.
- **`cas`** — implements the cas `BlobStore` port (content-addressed bytes, dedup) +
  an anchored-chain derivation log (input→output lineage).
- **`socket`** — connects to a **store daemon mounted on a Unix socket, in a room**:
  ```sh
  node store-daemon.mjs &              # mounts $ROOM/store.sock (default .room/)
  STORE=socket node audit.mjs          # audits through the mounted store
  ```
  The room (`ROOM=`, default `.room/`) is the mount point — the guest-room-style
  home for the socket "door"; the CAS blobs/refs/lineage live under `<room>/cas`.

## Status
v0.1 — runnable. Deterministic + caching + grounding verified; the Anthropic path is
implemented (live-verify with a key). See open issues for productionization
(`cas`/`anchored-chain` backing, real `strings.json` catalog).

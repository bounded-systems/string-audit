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
1. **Symbols, not blobs** — `tagline → { type: "tagline", value: "Bounded authority for AI agents" }`.
   The **type is the contract**; it decides which audits apply.
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
  system prompt. The `report` tool is authored once as a
  [`verbspec`](https://github.com/bounded-systems/verbspec) `VerbSpec` and projected to
  the Anthropic tool surface (`toAnthropicTool`), so its schema can't drift from the
  CLI / MCP projections of the same verb.

## Surfaces — one verb, many projections
`audit` and `extract` are [`verbspec`](https://github.com/bounded-systems/verbspec)
`VerbSpec`s (typed Zod input/output) in [`verbs.mjs`](verbs.mjs); each surface is a
projection of the same contract — `run` computes the structured `output`, `render` is the
human CLI view, and MCP / agents consume `output` directly:
- **CLI** — `node audit.mjs` / `node extract.mjs <surface.html>` (the `string-audit` bin).
  The env knobs still work (`CATALOG`, `GROUNDING`, `STORE`, `AUDIT_VERSION`, `AUDIT_VALE`,
  `ANTHROPIC_API_KEY`); flags override the runtime-read ones (`--catalog`, `--grounding`,
  `--store`, `--version`, `--vale`). `--help` is generated from the schema.
- **MCP** — `node mcp.mjs` (the `string-audit-mcp` bin) is a stdio MCP server exposing
  `audit` + `extract` as tools: `tools/list` is the projected toolset, `tools/call`
  validates arguments against the verb's Zod input and runs it. So an agent can audit copy
  or extract a surface as a tool call.
- **Anthropic** — the `report` tool (above) is the same projection (`toAnthropicTool`).

## Copy hygiene — deterministic prose checks
Run on every symbol, every run (cheap, never cached):
- **spell** — modern wordlist ∪ `dictionary.txt` (brand terms).
- **grammar/style** — write-good (passive, wordiness, weasel words).
- **ai-isms** — the formulaic tells of machine-written copy: `it isn't X — it's Y`
  antithesis, `the easy part … the hard part`, rule-of-three triads, em-dash cadence,
  rhetorical teaser fragments, chatbot artifacts/placeholders, and buzzword filler
  (`delve`, `seamless`, `leverage`, `unlock`, `robust` …). The patterns + lexicon are
  **data** in [`ai-tells.json`](ai-tells.json) (each rule carries its own severity), so
  they track the upstream corpus instead of living in code; the structural tells (dash
  count, anaphora, tricolons) stay in `prose.mjs`.
- **overclaims** — absolute, unprovable language bound to a coverage term (`every
  privileged effect`, `always enforced`); scope it or link a source. The prose analogue
  of the grounding check — ordinary `never`/`always` in plain prose is left alone.
- **proofread** — mechanical slips spell/grammar miss: doubled words, double/stray
  spaces, space-before-punctuation, missing space after a comma, repeated punctuation,
  mixed straight + curly quotes. The "was this even proof-read?" tells.
- **readability** — copy you bounce off: over-long sentences, and (for `body`/`meta`)
  genuinely dense prose by Flesch reading-ease. A proxy for "why am I reading this?".
- **overlap** — symbols whose copy is duplicated or near-duplicate.

Every finding carries a first-class **severity** `{ level, msg }` — `error` `✗`
(correctness/honesty: ungrounded, typos, overclaims) · `warn` `⚠` (ai-ism/proofread) ·
`suggestion` `·` — and `audit.mjs` renders the glyph from `level` (à la Vale severities).

The rules come from a cold read of the public copy ("AI-isms make me want to die"; "not
sure if proof read"; "never claim *every* privileged effect"). The keyed Anthropic
auditor is told the same rules, so the LLM path flags them too.

**Prior art.** For AI-tell linting specifically, [Vale](https://github.com/vale-cli/vale)
\+ [`vale-signs-of-ai-writing`](https://github.com/ammil-industries/vale-signs-of-ai-writing)
(which implements [Wikipedia's *Signs of AI writing*](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing))
cover the same ground at larger scale, with confidence tiers. Our lexicon is seeded from
that corpus; the differentiator here is the typed-symbol catalog, the content-hash cache,
and grounding/overclaim checking — none of which a prose linter does. See the open
"adopt Vale" issue for folding the two together.

## Reuses the bounded-systems stack
| Need | Primitive |
|---|---|
| hash-keyed result cache | [`cas`](https://github.com/bounded-systems/cas) — bytes by SHA-256 |
| signed, lineage-tracked derivations | [`anchored-chain`](https://github.com/bounded-systems/anchored-chain) |
| typed symbol catalog + per-type assertions | [`brand/content`](https://github.com/bounded-systems/brand) |
| one typed verb → CLI / MCP / Anthropic surfaces | [`verbspec`](https://github.com/bounded-systems/verbspec) — author a verb once, project everywhere |
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
v0.4.0 — runnable. Deterministic + caching + grounding verified; the Anthropic path is
implemented (live-verify with a key). `audit`/`extract` are authored once as
[`verbspec`](https://github.com/bounded-systems/verbspec) `VerbSpec`s and projected to CLI
+ MCP (the `string-audit-mcp` bin); the `report` tool is the same projection (#18, #19).
Copy-hygiene suite (ai-isms, overclaims, proofread, readability) with data-driven
[`ai-tells.json`](ai-tells.json) rules + first-class severity. The optional Vale provider
ships, gated on `AUDIT_VALE` (#6, #12); em-dash voice tells (antithesis, cadence) are
`suggestion`, not `warn`, so intentional voice doesn't gate downstream.
`cas`/`anchored-chain` are optional deps (the `STORE=cas`/socket backings); the default
run needs neither. The default catalog is the **real semantic-key registry** —
[`brand`](https://github.com/bounded-systems/brand)'s canonical content tokens, vendored
at `vendor/brand` (DTCG `content/strings.json`). Point `CATALOG=` at a surface's own
merged `content/strings.json` to audit its copy; the photo-frame demo catalog is gone.

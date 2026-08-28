---
bump: minor
---
grounding: accept a per-repo namespaced grounding source and match terms on word boundaries. `GROUNDING` may now be `{ "<repo>": ["term", …] }` as well as a flat array; a symbol keyed `<repo>.<key>` is grounded only by its own repo's terms, and a repo that declares none fails closed. Term matching moves from substring to word-boundary, so "agent" no longer grounds "agentic" or "management". The matcher is now single-sourced in `grounding.mjs` and shared by `audit-gate.mjs` and `types.mjs` instead of being duplicated in both. Flat sources keep working unchanged (content-catalog#14).

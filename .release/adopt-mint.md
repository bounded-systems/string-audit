---
bump: minor
---
adopt @bounded-systems/mint for versioning + signed release provenance: per-PR `.release/` intents → `mint version` → signed `v*` tag, replacing the hand-rolled auto-tagger (`release.yml` cut `vX.Y.Z` + `gh release create` on every package.json version change). The existing registry publish is unchanged — mint owns version + tag + provenance only.

# Release intents

This repo uses [@bounded-systems/mint](https://github.com/bounded-systems/mint)
for versioning. Each PR with a user-facing change drops **one intent file** here;
mint resolves the strongest `bump` and cuts the release deterministically —
replacing the hand-rolled auto-tagger that cut `vX.Y.Z` + a GitHub release on
every `package.json` version change.

Format — `.release/<slug>.md`:

```markdown
---
bump: minor   # patch | minor | major
---
short summary of the change (becomes the changelog line)
```

The `version` CI job runs `mint plan`, which validates every intent and previews
the next version on each PR (fails closed on a malformed intent). To cut a
release:

```sh
mint version   # bump package.json (+ lockfile) + prepend CHANGELOG.md, consume intents
mint release   # cut the signed v<version> tag + release provenance (CI keyless-signs it)
```

The `v<version>` tag drives `release.yml` (mint's in-toto release provenance:
tag → version plan → commit, keyless-signed via cosign/OIDC). The registry
publish stays in its own existing flow — mint owns **version + tag + provenance**
only.

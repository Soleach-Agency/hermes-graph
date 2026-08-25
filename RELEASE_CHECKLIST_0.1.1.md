# Hermes Graph 0.1.1 release checklist

This patch release preserves the validated `0.1.0` runtime while making the
public repository installable by Hermes Agent 0.20.5. That Hermes release can
load manifest v2, but its repository installer rejects manifests newer than v1.
Hermes Graph therefore uses the portable v1 manifest and keeps `api_version: 1`.

## Required checks

- [ ] Python contract/replay suite passes.
- [ ] Frontend unit suite and production build pass.
- [ ] `hermes plugins doctor . --ci` passes with all 14 declared hooks.
- [ ] An anonymous `git ls-remote` sees `main` and the release tag.
- [ ] A clean temporary Hermes home installs the immutable release commit with
  `hermes plugins install Soleach-Agency/hermes-graph --ref <commit> --no-enable`.
- [ ] Native doctor passes against the freshly installed temporary copy.
- [ ] The tested commit is tagged and published as GitHub release `v0.1.1`.

The `v0.1.0` tag remains immutable and records the original release candidate.

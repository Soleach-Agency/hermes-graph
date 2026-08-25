# Hermes Graph 0.1.1 release checklist

This patch release preserves the validated `0.1.0` runtime while making the
public repository installable by Hermes Agent 0.20.5. That Hermes release can
load manifest v2, but its repository installer rejects manifests newer than v1.
Hermes Graph therefore uses the portable v1 manifest and keeps `api_version: 1`.

## Required checks

- [x] Python contract/replay suite passes: 37 tests.
- [x] Frontend unit suite and production build pass.
- [x] `hermes plugins doctor . --ci` passes with all 14 declared hooks.
- [x] An anonymous `git ls-remote` sees public `main`.
- [x] A clean temporary Hermes home installs immutable commit
  `1a10527f743c6c63108587d335f82f6bb4918fd1` with
  `hermes plugins install Soleach-Agency/hermes-graph --ref <commit> --no-enable`.
- [x] Native doctor passes against the freshly installed temporary copy:
  Hermes Graph 0.1.1, zero tools, 14 hooks.
- [x] Anonymous Git access sees release tag `v0.1.1`; exact tagged commit
  `d2a373baac0cf4db195bf596428ef01dd5e7d4bf` installs and passes native doctor.
- [x] The tested commit is tagged and published as GitHub release `v0.1.1`.

The `v0.1.0` tag remains immutable and records the original release candidate.

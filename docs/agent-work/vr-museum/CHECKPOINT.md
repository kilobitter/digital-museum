# VR Museum checkpoint

Goal and scope: minimalist WebXR museum (Quest) + desktop blueprint editor; see SPEC.md.
Spec / plan: docs/agent-work/vr-museum/SPEC.md, briefs/T1.md, briefs/T2.md
Workspace and baseline: /Users/ghijs/development/Digital museum, T1 0b933bc, T2 d127856
Routing: root Opus; builder Sonnet (user confirmed via /tasks, 2026-10-27)

## Accepted work and fixed contracts
- src/shared/museum.ts (data contract, orchestrator-owned)
- T1 accepted (1 correction) and committed 0b933bc: viewer, shared logic (validate/geometry/zones), sample museum. Not yet seen in a headset.
- T2 accepted (1 correction) and committed d127856: editor.html (React+SVG), src/devserver/museumApi.ts dev API with loopback/header/Host/Origin guards.

## Active or unfinished work
- None running. Awaiting user browser test of the editor.

## Verification and blockers
- 2026-10-27 user desktop check of viewer: renders well, work labels correct. Audio zones / collision not explicitly confirmed. XR untested.

## Next actions
User tests editor in browser -> batch UI feedback into T3 (fixes + README + deploy setup) -> user Quest test.

## Standing user authorizations
- Build the full scope in SPEC.md.
- Commit locally after each accepted phase (2026-10-27). No push/deploy without asking.

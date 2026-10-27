# VR Museum checkpoint

Goal and scope: minimalist WebXR museum (Quest) + desktop blueprint editor; see SPEC.md.
Spec / plan: docs/agent-work/vr-museum/SPEC.md, briefs/T1.md, briefs/T2.md
Workspace and baseline: /Users/ghijs/development/Digital museum, T1 committed at 0b933bc
Routing: root Opus; builder Sonnet (user confirmed via /tasks, 2026-10-27)

## Accepted work and fixed contracts
- src/shared/museum.ts (data contract, orchestrator-owned)
- T1 accepted (1 correction) and committed 0b933bc: viewer, shared logic (validate/geometry/zones), sample museum. Not yet seen in a browser or headset.

## Active or unfinished work
- T2 (editor + dev API): dispatched to a fresh sonnet-builder, owns editor.html, src/editor/**, src/devserver/**, vite.config.ts, package*.json; report at reports/T2.md

## Verification and blockers
- 2026-10-27 user desktop check of viewer: renders well, work labels correct. Audio zones / collision not explicitly confirmed. XR untested.

## Next actions
Review T2 against 0b933bc -> accept/correct -> commit -> user desktop check of viewer + editor -> T3 (README, deploy) -> user Quest test.

## Standing user authorizations
- Build the full scope in SPEC.md.
- Commit locally after each accepted phase (2026-10-27). No push/deploy without asking.

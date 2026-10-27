# VR Museum checkpoint

Goal and scope: minimalist WebXR museum (Quest) + desktop blueprint editor; see SPEC.md.
Spec / plan: docs/agent-work/vr-museum/SPEC.md, briefs/T1.md, briefs/T2.md, briefs/T3.md, briefs/T4.md (ready, dispatch after T3 accepted)
Workspace and baseline: /Users/ghijs/development/Digital museum, T1 0b933bc, T2 d127856
Routing: root Opus; builder Sonnet (user confirmed via /tasks, 2026-10-27)

## Accepted work and fixed contracts
- src/shared/museum.ts (data contract, orchestrator-owned)
- T1 accepted (1 correction) and committed 0b933bc: viewer, shared logic (validate/geometry/zones), sample museum. Not yet seen in a headset.
- T2 accepted (1 correction) and committed d127856: editor.html (React+SVG), src/devserver/museumApi.ts dev API with loopback/header/Host/Origin guards.

## Active or unfinished work
- museum.ts bumped to v2 by Opus (uncommitted): labels on MediaItem, WallFinish (settings default + per-wall override), 'texture' media kind.
- T3 dispatched (v2 migration, wall textures, random hang at placement, library sections, non-loopback banner, port 5317 strictPort, README, GitHub Pages workflow). Report at reports/T3.md.
- User's real museum in public/museum/museum.json (v1, uncommitted, sha d2a5e2da…); backup in session scratchpad user-museum-before-T3.json.

## Verification and blockers
- 2026-10-27 user desktop check of viewer: renders well, work labels correct. Audio zones and wall collision confirmed working on desktop. XR untested.

## Next actions
Review T3 -> commit (code + contract; ask user before committing their museum content) -> user editor retest -> user Quest test -> user creates GitHub repo + pushes (their action).

## Standing user authorizations
- Build the full scope in SPEC.md.
- Commit locally after each accepted phase (2026-10-27). No push/deploy without asking.
- Decisions 2026-10-27: random painting chosen at placement time; wall finish whole-wall; hosting GitHub Pages.
- Scale 2026-10-27: ~400-500 paintings, ~90 short MP3/M4A loops. Metadata via filename 'Artist - Title.ext' + typing in editor. Stay on GitHub Pages (~150 MB images at 1600 px); R2 only if outgrown.

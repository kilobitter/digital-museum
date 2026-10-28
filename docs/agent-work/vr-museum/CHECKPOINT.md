# VR Museum checkpoint

Goal and scope: minimalist WebXR museum (Quest) + desktop blueprint editor; see SPEC.md.
Spec / plan: docs/agent-work/vr-museum/SPEC.md, briefs/T1.md, briefs/T2.md, briefs/T3.md, briefs/T4.md (ready, dispatch after T3 accepted)
Workspace and baseline: /Users/ghijs/development/Digital museum, T1 0b933bc, T2 d127856, T3 66d7ec7, T4 d788ba9, T5 f09c9fb, T6 a5eb929, T7 2a89933, T8 (next commit)
Routing: root Opus; builder Sonnet (user confirmed via /tasks, 2026-10-27)

## Accepted work and fixed contracts
- T10 accepted (0 corrections): multiSelect.ts (box/shift/Ctrl+A, move, rotate [ ], duplicate, delete, batch wall finish, Include areas toggle), doorway.ts + Door tool (D). UI unverified in browser.
- T9 accepted (0 corrections; 2 small Opus fixes: upload URL from disk-backed file, 'Choose another folder' on invalid screen): hosted editor.html with File System Access folder store, MuseumStore abstraction, ?source=folder viewer preview, shared mediaFiles.ts. Browser behaviour unverified.
- Collaboration track (user-approved 2026-10-28): T9 hosted editor (done) -> T10 multi-select + group move/nudge/rotate 90/delete/duplicate/batch wall finish + Door tool -> T11 import (folder or .zip, re-id, keep their look, place right of host, select imported) + export .zip, no new deps, one-time copy.
- src/shared/museum.ts (data contract, orchestrator-owned)
- T1 accepted (1 correction) and committed 0b933bc: viewer, shared logic (validate/geometry/zones), sample museum. Not yet seen in a headset.
- T8 accepted: museum.ts v4 (Sky gradient/panorama, 'panorama' media, Area.openSky), sky sphere, ceiling decomposition (no ceiling offsets), Panoramas tab, sky settings.
- T7 accepted (1 correction): museum.ts v3 (floor/ceiling finishes, rectangular areas, v1/v2 migration), Areas editor layer with Fill room + stacking, world-aligned floor/ceiling textures, overlap-based stack levels.
- T6 resizable library grid; T5 library tabs; dca3523 dev plugin serves public/museum from disk (new uploads were 404ing).
- T4 accepted (1 correction): streaming viewer (paintings 15/20 m cap 70, audio 10/15 m cap 8), merged static meshes, ?debug overlay, bulk upload queue, filename parsing, library search/filter, fill wall, stress generator.
- T3 accepted (0 corrections), committed 66d7ec7: museum.ts v2 (labels on MediaItem, WallFinish, texture kind) + migration, wall textures, random hang, port 5317, README, Pages workflow.
- T2 accepted (1 correction) and committed d127856: editor.html (React+SVG), src/devserver/museumApi.ts dev API with loopback/header/Host/Origin guards.

## Active or unfinished work
- No builder running. Waiting on user: editor retest, Quest test, decision on committing museum content, GitHub repo + push.
- User's real museum in public/museum/museum.json (v1, uncommitted, sha d2a5e2da…); backup in session scratchpad user-museum-before-T3.json.

## Verification and blockers
- 2026-10-27 user desktop check of viewer: renders well, work labels correct. Audio zones and wall collision confirmed working on desktop. XR untested.

## Next actions
User editor retest -> user Quest test -> user creates GitHub repo + pushes (their action).

## Standing user authorizations
- Build the full scope in SPEC.md.
- Commit locally after each accepted phase (2026-10-27). No push/deploy without asking.
- Decisions 2026-10-27: random painting chosen at placement time; wall finish whole-wall; hosting GitHub Pages.
- Scale 2026-10-27: ~400-500 paintings, ~90 short MP3/M4A loops. Metadata via filename 'Artist - Title.ext' + typing in editor. Stay on GitHub Pages (~150 MB images at 1600 px); R2 only if outgrown.

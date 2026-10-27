# VR Museum — spec

## Goal
A minimalist VR museum for a university course. Students' images hang on walls; audio
fragments loop inside zones on the floor. One person builds the museum in a desktop
top-down blueprint editor; visitors open a URL in a Meta Quest browser and walk, look, listen.

## Decisions (user-confirmed 2026-10-27)
- Target: Meta Quest 2/3/Pro, WebXR in the Quest browser. Desktop browser preview too.
- Hosting: **static site, one editor.** Editor runs only on the editor's machine via the
  Vite dev server, which saves straight into `public/museum/`. `npm run build` produces a
  static viewer-only site deployable to GitHub Pages / Netlify.
- Locomotion: teleport + snap turn by default; smooth thumbstick walking as a toggle.
- Audio: ambient (non-directional) zones, fading at edges, overlapping zones mix.

## Non-goals
Multi-user editing, accounts, a backend, hand tracking, spatial/positional audio,
video, 3D sculptures, mobile phone VR, curved/irregular wall geometry beyond straight segments.

## Architecture
- Vite + TypeScript, one repo. `index.html` = viewer (Three.js + WebXR, vanilla TS).
  `editor.html` = editor (React + SVG blueprint), **dev server only** (excluded from build).
- Vite config `base: './'` so the build works on any sub-path.
- Data contract: `src/shared/museum.ts` (fixed). Content lives at
  `public/museum/museum.json` + `public/museum/media/*`. Viewer fetches `./museum/museum.json`.
- `src/shared/` also holds pure, unit-tested logic used by both sides: validation,
  geometry (wall normals, work placement, segment distance), zone gain.
- Dev-only API (Vite plugin middleware), loopback requests only:
  - `PUT /api/museum` — body = Museum JSON; validate, atomic write (tmp + rename).
  - `POST /api/media?name=<original>` — raw body; server picks id + extension from an
    allowlist (jpg, jpeg, png, webp, mp3, m4a, aac, ogg, wav); writes `public/museum/media/<id>.<ext>`;
    returns `{ file }`. Size cap 50 MB.
  - `DELETE /api/media?file=media/<id>.<ext>` — strict pattern match, no traversal.
  - Requests from non-loopback addresses get 403 (dev server is LAN-exposed with HTTPS for Quest testing).
- `npm run dev` serves over HTTPS on the LAN (`@vitejs/plugin-basic-ssl`) so a Quest on the
  same Wi-Fi can preview before deploying.

## Viewer behaviour
- Loading screen, then a start overlay ("Enter VR" if `immersive-vr` supported, plus
  "Walk on desktop"). Audio starts on that user gesture.
- White-cube look: light floor, white walls (thickness/height from settings), optional
  ceiling over the walls' bounding box + margin, soft hemisphere + ambient light, no shadows.
- Works: image plane on the given wall face, offset ~1 cm from the surface, unlit
  (true colours), thin frame/border optional; label (title, artist, optional description)
  as a small canvas texture to the lower right of the work.
- Audio zones: one gapless looping source per zone (decoded AudioBuffer), gain per frame =
  `volume * edgeFactor(distanceInside / fade)` with a smooth curve, short time-constant ramp
  to avoid zipper noise. Zones whose gain is 0 may keep playing silently (simplest) — fine.
- XR locomotion: teleport (right thumbstick forward → parabolic arc, release to teleport;
  valid only on the floor and not through/into walls), snap turn 30° (right thumbstick left/right),
  smooth mode (left thumbstick, head-relative, ~1.4 m/s, wall collision with sliding).
  Toggle mode with left-controller X button; brief on-screen hint after toggle.
- Desktop: pointer-lock mouse look, WASD, same collision.
- Quest performance: textures capped at 2048 px with mipmaps, foveation on, no shadows,
  pixel ratio capped.

## Editor behaviour
- SVG blueprint, grid in metres, snap to `gridSize`, pan (space/middle drag) and zoom (wheel).
- Tools: Select (V), Wall (W, click-chain, Esc ends), Room (R, drag rectangle → 4 walls),
  Work (place selected library image: click near a wall face; snaps to face side and t),
  Zone rect (Z) / circle (C), Spawn (P). Delete/Backspace removes selection.
- Select/drag: wall endpoints (coincident endpoints move together), whole walls, works
  slide along their wall, zones move/resize. Works whose wall is deleted are deleted too.
- Inspector for the selection; settings panel for museum settings.
- Media library: drag-drop upload; images resized client-side to max 2048 px, JPEG q≈0.85;
  thumbnails, audio preview, usage count, delete unused.
- Undo/redo, Ctrl+S save, debounced autosave, dirty indicator, "Preview" opens the viewer.

## Acceptance (overall)
Build passes; unit tests cover shared logic; a sample museum renders on desktop; the
editor round-trips a museum through the dev API; the user confirms on a Quest.

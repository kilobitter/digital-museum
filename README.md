# VR Museum

A small virtual museum you build in a browser editor and walk through on a desktop or a Meta Quest
(WebXR). You draw rooms on a blueprint, hang paintings, set wall finishes and place looping audio
zones. The result is a static site that can be hosted on GitHub Pages.

## Requirements
- Node.js 20.19 or newer (LTS) and npm
- A desktop browser for editing; Chrome or Edge recommended
- Optional: a Meta Quest on the same Wi-Fi for previewing

## Install
```
npm install
```

## Editing
```
npm run dev
```
Then open **https://localhost:5317/editor.html** and accept the self-signed certificate warning.
The editor only saves from this computer (the write API refuses other machines); if you open it from
another address it shows a banner and disables saving and uploads. Port 5317 is fixed on purpose: if
it is taken, the server stops instead of quietly picking another port.

- The museum lives in `public/museum/museum.json`, its images and audio in `public/museum/media/`.
  The editor saves there automatically (and with Ctrl/Cmd+S).
- The media library has three sections: **Paintings**, **Textures** (wall finishes) and **Audio**.
  Add files with the section's Add button or by dropping them on it. Paintings are resized to 1600 px
  (longest side, JPEG), textures to 1024 px. You can drop or pick hundreds of files at once: they upload
  three at a time with an "n / total" counter, one failing file never stops the rest, and files already
  in the library are skipped (same original name and a known, equal size).
- **Filename convention** for paintings: `Artist - Title.jpg` fills the artist and title automatically
  (`_` counts as a space, extra spaces are ignored, the first ` - `, ` – ` or ` — ` splits; a hyphen
  without spaces, as in `Jean-Luc`, does not). `Sunrise.jpg` becomes the title "Sunrise" with no artist.
- The Paintings library has search (title, artist, file name), an All / Hung / Unhung filter and counts.
- **Fill face with random paintings**: select a wall, open the section in the inspector, choose face,
  width, gap and centre height. It hangs as many paintings as fit evenly (unhung ones first) as one
  undo step. It refuses when that face already has works.
- Title, artist and description belong to the painting, not to one place on the wall.
- **Random painting** hangs an unhung painting (random) on each click; "Pick another" in a work's
  inspector swaps it.
- Walls use the default finish from the museum settings, or their own (colour, or texture times
  colour, tiled at a size in metres).
- **Floors and ceilings**: the museum settings hold a default floor finish and ceiling finish (colour,
  or texture times colour, tiled at a size in metres). Floor and ceiling textures are aligned to the
  world origin, so neighbouring surfaces with the same finish continue seamlessly.
- **Areas** are rectangles that override the floor and/or ceiling finish inside them. They live on their
  own editing layer so walls never get in the way: press `A` (or click the layer button at the top of
  the toolbar) to switch between **Build** (walls, works, zones, spawn) and **Areas**. On the Areas layer
  walls and works are dimmed and locked; on the Build layer areas are faint and locked.
  - Tools: Select (move, drag a corner to resize, Delete, Ctrl/Cmd+D duplicates), Rect (drag; edges snap
    to the grid and to wall centre lines within 0.3 m) and **Fill room** (click inside a room: the area
    covers the rectangle bounded by the nearest walls in the four directions, ignoring doorway gaps;
    nothing is made when a side is open).
  - Stacking: later areas sit on top of earlier ones. Use Bring forward / Send backward / To front /
    To back in the area inspector. In the visitor view each overlapping level is 1 mm higher (floor) or lower
    (ceiling), and all areas with the same finish are merged into one mesh, so area count does not add
    draw calls (only distinct finishes do).
  - Ceiling areas only show when the ceiling is switched on in the settings.
- Older `museum.json` files (format v1 and v2) are upgraded automatically the next time they are saved.
- `node scripts/make-sample.mjs <outDir>` writes a sample museum to a folder of your choice. It refuses
  to overwrite `public/museum` unless you pass `--force`.

The visitor view is `https://localhost:5317/` (the Preview button in the editor).

## Previewing on a Quest
Run `npm run dev` and open the **Network** URL it prints (for example `https://192.168.x.x:5317/`) in the
Quest browser, on the same Wi-Fi. Accept the certificate warning, then press **Enter VR**. The editor is
not meant to be used from the headset.

## Controls
- Headset: right stick forward = teleport, right stick sideways = snap turn, left X button = switch
  between teleporting and smooth walking (left stick).
- Desktop: WASD or arrow keys to move, mouse to look (click to capture the mouse, Esc to release).

## Content guidance
- Prefer **mp3 or m4a** over wav: wav files are large and slow to load on a headset. Keep each audio
  loop **under 2 minutes**: it is decoded to raw samples while you are near it (about 10 MB per
  minute of stereo audio).
- Paintings are resized on upload (1600 px, JPEG), so very large originals are not needed.
- Rough storage: a painting is about 250-500 KB, so 500 paintings are roughly 125-250 MB; 90 loops of
  2 minutes at 128 kbps are about 2 MB each, roughly 180 MB. About 0.4 GB in total, well under the
  **1 GB** a Pages site should stay below (GitHub rejects single files over **100 MB**).

## Large museums on a headset
The viewer streams: paintings load within about 15 m of the visitor and are released beyond 20 m (at
most 70 at once), audio loops are fetched and decoded within 10 m of a zone and released beyond 15 m (at
most 8 at once). Frames, walls and placeholders are merged into a few draw calls, so memory and draw
calls stay bounded however many works there are. Paintings far away show a plain grey panel until
they stream in.

Add `?debug` to the viewer URL (for example `https://localhost:5317/?debug`) to show an overlay with
draw calls, triangles, GPU textures, resident paintings and decoded audio zones.

To stress-test, `node scripts/make-stress.mjs <outDir>` writes a museum with 90 rooms, 500 works and 90 zones
into a folder of your choice (it refuses to write into `public/museum`).

## Deploying to GitHub Pages
1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository: **Settings > Pages > Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` (tests, build, deploy). The site appears at
   `https://<user>.github.io/<repo>/`. The build uses relative paths, so the sub-path works.

The editor is not part of the published site; only the viewer and `public/museum/` are.

## Scripts
- `npm run dev`: dev server with the editor
- `npm test`: unit tests
- `npm run build`: type-check and build the static viewer into `dist/`
- `npm run preview`: serve `dist/` locally

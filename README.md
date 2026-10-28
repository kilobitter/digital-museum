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
On `localhost` the dev server's own write API saves straight into `public/museum/` (it refuses other
machines). Add `?folder` to the address to try the collaborator flow below instead. Port 5317 is fixed
on purpose: if it is taken, the server stops instead of quietly picking another port.

- The museum lives in `public/museum/museum.json`, its images and audio in `public/museum/media/`.
  The editor saves there automatically (and with Ctrl/Cmd+S).
- The media library has four sections: **Paintings**, **Textures** (wall, floor and ceiling finishes), **Panoramas** (sky images) and **Audio**.
  Add files with the section's Add button or by dropping them on it. Paintings are resized to 1600 px
  (longest side, JPEG), textures to 1024 px, panoramas to 4096 px (JPEG, quality 0.85). You can drop or pick hundreds of files at once: they upload
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
    To back in the area inspector. In the visitor view each overlapping floor level is 1 mm higher, and
    all areas with the same finish are merged into one mesh, so area count does not add draw calls
    (only distinct finishes do). Ceilings are not layered: the viewer cuts the ceiling into a flat grid
    along the area edges and the top-most area with a ceiling finish or open sky wins in each cell.
  - Each area has a **Floor** (optional finish) and a **Ceiling** choice: **None** (the area does not
    touch the ceiling), **Finish** (its own ceiling finish) or **Open sky** (no ceiling there). An area
    needs at least one of floor, ceiling finish or open sky. Open-sky areas are drawn with a blue hatch
    on the blueprint and tagged `O` (for example `F+O`).
  - Ceiling settings only show when the ceiling is switched on in the museum settings.
- **Sky**: set in the museum settings. It is what you see beyond the walls and through open-sky areas.
  - *Gradient*: three colours (top, horizon, bottom), blended smoothly around the horizon.
  - *Panorama*: an equirectangular image from the Panoramas tab, plus a rotation (-180 to 180 degrees,
    clockwise seen from above; 0 puts the image centre straight up the blueprint). The image should be
    **2:1** (the editor warns otherwise) and is resized to at most **4096 px**. Good free sources:
    [Poly Haven](https://polyhaven.com/hdris) HDRIs, which are CC0. Download the tonemapped **JPG**
    (not the .hdr/.exr), 4k is plenty. If the panorama file is missing the viewer falls back to the
    default gradient and shows a warning. The sky is not lit or fogged and does not move when you walk.
  - The lighting inside the museum is the same everywhere, so a very bright or dark panorama does not
    change how open areas are lit.
- Older `museum.json` files (format v1, v2 and v3) are upgraded automatically the next time they are saved.
- `node scripts/make-sample.mjs <outDir>` writes a sample museum (with a small open-sky courtyard) to a folder of your choice. It refuses
  to overwrite `public/museum` unless you pass `--force`.

The visitor view is `https://localhost:5317/` (the Preview button in the editor).

## For collaborators
You can build your own museum without installing anything. You need **Chrome or Edge on a laptop or
desktop computer** (Safari, Firefox, phones and tablets do not work; in Brave, first enable
`brave://flags/#file-system-access-api`).

1. Open the editor link you were given (it ends in `/editor.html`).
2. Make a new, empty folder on your computer, for example `My museum`.
3. Click **Open museum folder** and pick that folder. The editor creates your museum there.
4. Draw rooms, add paintings and sounds, and hang them. Everything saves into the folder by itself
   (also with Ctrl/Cmd+S). Nothing is uploaded to the internet.

Where your files live: `museum.json` (the plan) and a `media` folder (your images and audio) inside the
folder you picked. **Keep that folder**: it is your museum. Next time, open the editor and click
**Reopen "My museum"**, then allow access when the browser asks.

- **Preview** (top right) opens your museum in the walkable viewer in a new tab. It reads your folder
  directly, works on a computer only (not in a headset), and asks once to allow access.
- **Sending it to someone**: zip the whole folder and send the zip. They can unzip it and open it in the
  editor, or copy its contents into `public/museum/` of this project.
- Use **one folder per museum**. Use **Switch folder** in the top bar to change museums.
- Do not edit the same folder in two tabs, and do not edit `museum.json` by hand while the editor is
  open. If the file changes behind the editor's back (another tab, a sync program such as Dropbox or
  OneDrive, copying files in), saving pauses and you choose **Reload from folder** or **Overwrite**.
- Only `museum.json` and the `media` folder inside your folder are ever touched.

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
into a folder of your choice (it refuses to write into `public/museum`). It includes a few open-sky courtyards.

## Deploying to GitHub Pages
1. Create a GitHub repository and push this project to its `main` branch.
2. In the repository: **Settings > Pages > Source: GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` (tests, build, deploy). The site appears at
   `https://<user>.github.io/<repo>/`. The build uses relative paths, so the sub-path works.

The published site contains the viewer (`index.html`, showing `public/museum/`) and the editor
(`editor.html`). On the published site the editor always uses the folder flow described under
"For collaborators": it never writes to the site itself. The dev write API exists only in `npm run dev`.

## Scripts
- `npm run dev`: dev server with the editor
- `npm test`: unit tests
- `npm run build`: type-check and build the static viewer and editor into `dist/`
- `npm run preview`: serve `dist/` locally

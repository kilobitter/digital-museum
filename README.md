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
  Add files with the section's Add button or by dropping them on it. Paintings are resized to 2048 px,
  textures to 1024 px.
- Title, artist and description belong to the painting, not to one place on the wall.
- **Random painting** hangs an unhung painting (random) on each click; "Pick another" in a work's
  inspector swaps it.
- Walls use the default finish from the museum settings, or their own (colour, or texture times
  colour, tiled at a size in metres).
- Older `museum.json` files (format v1) are upgraded automatically the next time they are saved.
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
- Prefer **mp3 or m4a** over wav: wav files are large and slow to load on a headset.
- GitHub rejects files over **100 MB**, and a Pages site should stay under about **1 GB** in total.
- Keep paintings reasonable; they are resized on upload, so very large originals are not needed.

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

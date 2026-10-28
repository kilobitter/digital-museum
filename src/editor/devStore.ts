// The local-development store: persistence goes through the Vite dev API (src/devserver/museumApi.ts).
// Only ever imported dynamically behind `import.meta.env.DEV`, so none of this reaches a production build.
import { deleteMediaFile, loadMuseum, saveMuseum, uploadMedia } from './api';
import type { MuseumStore } from './store';

export const devStore: MuseumStore = {
  kind: 'dev',
  label: 'Dev server',
  writable: true,
  previewUrl: './index.html',
  load: loadMuseum,
  save: (m) => saveMuseum(m),
  upload: uploadMedia,
  deleteMedia: deleteMediaFile,
  mediaUrl: (file) => `./museum/${file}`,
  dispose: () => {},
};

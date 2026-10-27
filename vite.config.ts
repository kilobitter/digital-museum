import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { museumApi } from './src/devserver/museumApi';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

// The editor (editor.html, src/editor, the dev API) is dev-server only: the build input is
// index.html alone, and the API plugin has `apply: 'serve'`.
export default defineConfig({
  base: './',
  plugins: [basicSsl(), react(), museumApi(projectRoot)],
  server: {
    host: true,
    // The editor saves into public/museum; don't let those writes reload open pages.
    watch: { ignored: ['**/public/museum/**'] },
  },
  build: { target: 'es2022' },
});

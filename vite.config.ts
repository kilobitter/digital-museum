import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { museumApi } from './src/devserver/museumApi';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

// The build has two pages: the viewer (index.html) and the editor (editor.html), which collaborators
// use on the hosted site with their own folder. The dev write API is dev-server only (`apply: 'serve'`)
// and the editor only loads it behind `import.meta.env.DEV`, so it never reaches the build.
export default defineConfig({
  base: './',
  plugins: [basicSsl(), react(), museumApi(projectRoot)],
  server: {
    host: true,
    // A fixed, uncommon port; fail loudly instead of silently moving to another one when it is taken
    // (e.g. by another project's dev server).
    port: 5317,
    strictPort: true,
    // The editor saves into public/museum; don't let those writes reload open pages.
    watch: { ignored: ['**/public/museum/**'] },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
      },
    },
  },
});

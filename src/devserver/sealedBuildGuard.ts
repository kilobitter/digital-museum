import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Build only: after the bundle (and the public-dir copy) is written, delete `<outDir>/museum` so the
 * plaintext museum can never be published, and warn when the sealed copy is missing.
 */
export function sealedBuildGuard(): Plugin {
  let outDir = '';
  return {
    name: 'vr-museum-sealed-build-guard',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        rmSync(join(outDir, 'museum'), { recursive: true, force: true });
        if (!existsSync(join(outDir, 'sealed', 'manifest.json'))) {
          console.warn('\n[sealed] WARNING: public/sealed/manifest.json is missing, so the published viewer has nothing to open. Run `npm run seal`.\n');
        }
      },
    },
  };
}

import type { Plugin } from 'vite';

import { createReadStream, statSync } from 'node:fs';
import { join, sep } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DEMO_MENU_DIR = join(import.meta.dirname, 'demo-menu');

/**
 * Serves `./demo-menu` at `/demo-menu` in `vite dev`. Builds leave it out: deployed stages read the photos from the
 * `DemoMenuFiles` bucket behind the same CloudFront (`npm run demo-images:dev`).
 */
const demoMenuFiles = (): Plugin => ({
  name: 'demo-menu-files',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/demo-menu', (request, response, next) => {
      const file = join(DEMO_MENU_DIR, decodeURIComponent((request.url ?? '').split('?')[0]!));

      if (!file.startsWith(DEMO_MENU_DIR + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
        next();
        return;
      }

      response.setHeader('Content-Type', 'image/webp');
      createReadStream(file).pipe(response);
    });
  }
});

export default defineConfig({
  server: {
    port: 3000
  },
  build: {
    rolldownOptions: {
      // One app chunk plus one vendor chunk (cached across deploys) instead of a file per route: a deploy uploads
      // few files and open tabs never ask for route chunks a newer deploy removed. Not recursive: Start's client
      // entry (in node_modules) imports `src/router.tsx`, which would pull the whole app into the group.
      output: {
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/, includeDependenciesRecursively: false }] }
      }
    }
  },
  plugins: [
    tanstackStart({
      // Start always enables route code splitting; an empty grouping keeps every route in the main bundle.
      router: { codeSplittingOptions: { defaultBehavior: [] } },
      // `index.html` is the CloudFront default object and the target of the SPA rewrite.
      spa: { enabled: true, prerender: { outputPath: '/index.html' } }
    }),
    viteReact(),
    tailwindcss(),
    demoMenuFiles()
  ]
});

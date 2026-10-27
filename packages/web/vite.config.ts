import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
    tailwindcss()
  ]
});

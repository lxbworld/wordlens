import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two builds, because a Manifest V3 content script must be a classic script:
//  - `content` mode: esbuild-style IIFE bundle -> dist/content.js
//  - `popup` mode:   normal HTML build       -> dist/popup/index.html
const root = import.meta.dirname;
const outDir = 'dist';

export default defineConfig(({ mode }) => {
  if (mode === 'content') {
    return {
      root,
      publicDir: 'public',
      build: {
        outDir,
        emptyOutDir: true,
        target: 'chrome110',
        minify: false,
        lib: {
          entry: resolve(root, 'src/content/index.ts'),
          name: 'WordLens',
          formats: ['iife'],
          fileName: () => 'content.js',
        },
      },
    };
  }

  return {
    root: resolve(root, 'src'),
    base: './',
    build: {
      outDir: resolve(root, outDir),
      emptyOutDir: false,
      target: 'chrome110',
      minify: false,
      rollupOptions: {
        input: resolve(root, 'src/popup/index.html'),
        output: {
          entryFileNames: 'popup/[name].js',
          assetFileNames: 'popup/[name][extname]',
        },
      },
    },
  };
});

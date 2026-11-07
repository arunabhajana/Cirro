import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, copyFileSync,cpSync,existsSync } from 'node:fs';

export default defineConfig({
  plugins: [react(), {
    name: 'cirro-android-entry',
    transformIndexHtml: { order: 'pre', handler: html => html.replace('/src/main.tsx', '/src/platforms/android/main.tsx').replace('<script src="/theme-init.js"></script>', '') },
    closeBundle() {
      mkdirSync('dist-android/branding', { recursive: true });
      for (const name of ['cirro-transparent.png', 'cirro-transparent-128.png']) copyFileSync(`public/branding/${name}`, `dist-android/branding/${name}`);
      if(existsSync('public/pdfjs'))cpSync('public/pdfjs','dist-android/pdfjs',{recursive:true});
    },
  }],
  publicDir: false,
  build: { outDir: 'dist-android', emptyOutDir: true },
});

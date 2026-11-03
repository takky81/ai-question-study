import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolveBase } from './src/lib/basePath.ts';

export default defineConfig(({ command }) => ({
  // 開発時はルート、ビルド時は GitHub Pages のサブパス（CI の GITHUB_REPOSITORY から決定）
  base: resolveBase({ command, repository: process.env.GITHUB_REPOSITORY }),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}));

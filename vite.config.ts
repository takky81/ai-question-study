import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
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
  test: {
    // ユニットテストはモジュール隣の src 配下だけを対象にする（e2e/ は Playwright が実行する）
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}));

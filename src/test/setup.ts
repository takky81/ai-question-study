// 全ユニットテスト共通の setup: jest-dom matcher の登録と、テストごとの描画の後始末
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

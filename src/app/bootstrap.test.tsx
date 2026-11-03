import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrap } from './bootstrap';

let root: Root | undefined;
let container: HTMLElement;

function setup(): Root {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return root;
}

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

describe('bootstrap', () => {
  it('環境変数が欠けていればアプリ本体を読み込まず、欠けた変数名を日本語で表示する（1.6）', async () => {
    const loadApp = vi.fn();
    await act(() => bootstrap(setup(), { VITE_SUPABASE_URL: 'http://x' }, loadApp));
    expect(loadApp).not.toHaveBeenCalled();
    expect(container.textContent).toContain('設定が不足しています');
    expect(container.textContent).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(container.textContent).not.toContain('VITE_SUPABASE_URL');
  });

  it('両方欠けていれば両方の変数名を列挙する', async () => {
    const loadApp = vi.fn();
    await act(() => bootstrap(setup(), {}, loadApp));
    expect(loadApp).not.toHaveBeenCalled();
    expect(container.textContent).toContain('VITE_SUPABASE_URL');
    expect(container.textContent).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });

  it('検証成功時はアプリ本体を動的に読み込んで描画する（3.6）', async () => {
    const loadApp = vi.fn(async () => ({ App: () => <p>アプリ本体</p> }));
    await act(() => bootstrap(setup(), { VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }, loadApp));
    expect(loadApp).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('アプリ本体');
    expect(container.textContent).not.toContain('設定が不足しています');
  });

  it('アプリ本体の読み込みに失敗したら、空白にせず再読み込みを促す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadApp = vi.fn(async () => {
      throw new Error('chunk load failed');
    });
    await act(() => bootstrap(setup(), { VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }, loadApp));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('読み込みに失敗しました');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

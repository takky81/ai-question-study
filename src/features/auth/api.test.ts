import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }));

import * as api from './api';
import { signIn, signOut, toAuthErrorMessage } from './api';

const INVALID = 'メールアドレスまたはパスワードが正しくありません';
const NETWORK = 'ログインできませんでした。通信状況を確認して再度お試しください';

describe('toAuthErrorMessage', () => {
  it('invalid_credentials は誤認証の文言にする', () => {
    expect(toAuthErrorMessage({ code: 'invalid_credentials', status: 400, message: 'x' })).toBe(
      INVALID,
    );
  });

  it('status 400 は誤認証の文言にする', () => {
    expect(toAuthErrorMessage({ status: 400, message: 'Invalid login credentials' })).toBe(INVALID);
  });

  it.each([
    { status: 0, message: 'Failed to fetch' },
    { status: 500, message: 'Internal error' },
    { status: 503, message: 'unavailable' },
    { message: 'TypeError: network' },
  ])('通信失敗やサーバーエラー %o は通信障害の文言にする', (error) => {
    expect(toAuthErrorMessage(error)).toBe(NETWORK);
  });
});

describe('signIn', () => {
  beforeEach(() => {
    auth.signInWithPassword.mockReset();
  });

  it('成功時は入力をそのまま渡して解決する', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    await expect(signIn({ email: 'a@example.com', password: 'p' })).resolves.toBeUndefined();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'p' });
  });

  it('誤認証は日本語の Error で失敗する', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    });
    await expect(signIn({ email: 'a@example.com', password: 'bad' })).rejects.toThrow(INVALID);
  });

  it('例外による通信失敗は通信障害の Error で失敗する', async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(signIn({ email: 'a@example.com', password: 'p' })).rejects.toThrow(NETWORK);
  });
});

describe('signOut', () => {
  it('成功時は解決する', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).resolves.toBeUndefined();
  });

  it('失敗時は日本語の Error で失敗する', async () => {
    auth.signOut.mockResolvedValue({ error: { status: 500, message: 'x' } });
    await expect(signOut()).rejects.toThrow('ログアウトできませんでした');
  });
});

describe('公開 API', () => {
  it('登録操作を公開しない', () => {
    expect(Object.keys(api).sort()).toEqual(['signIn', 'signOut', 'toAuthErrorMessage']);
  });
});

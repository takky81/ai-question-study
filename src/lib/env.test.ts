import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('両方の変数があれば成功し、値を返す', () => {
    const result = parseEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54521',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxx',
    });
    expect(result).toEqual({
      ok: true,
      env: { supabaseUrl: 'http://127.0.0.1:54521', supabasePublishableKey: 'sb_publishable_xxx' },
    });
  });

  it('2変数以外の値は結果に含めない', () => {
    const result = parseEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54521',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxx',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
    });
    expect(result.ok && Object.keys(result.env).sort()).toEqual(['supabasePublishableKey', 'supabaseUrl']);
  });

  it('URL だけ欠けていれば URL の名前を列挙する', () => {
    expect(parseEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_URL'],
    });
  });

  it('公開キーだけ欠けていれば公開キーの名前を列挙する', () => {
    expect(parseEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54521' })).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_PUBLISHABLE_KEY'],
    });
  });

  it('両方欠けていれば両方の名前を列挙する', () => {
    expect(parseEnv({})).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
    });
  });

  it('空文字は欠けとみなす', () => {
    expect(parseEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_URL'],
    });
  });
});

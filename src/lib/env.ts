// 接続設定の検証。クライアントへ公開してよい2変数だけを読む（service_role などの秘密は扱わない）。

export type AppEnv = { supabaseUrl: string; supabasePublishableKey: string };
export type EnvResult = { ok: true; env: AppEnv } | { ok: false; missing: string[] };

const URL_KEY = 'VITE_SUPABASE_URL';
const PUBLISHABLE_KEY_KEY = 'VITE_SUPABASE_PUBLISHABLE_KEY';

/** 必要な変数がそろっていれば値を、欠けていれば（空文字を含む）欠けた変数名を返す。 */
export function parseEnv(raw: Record<string, string | undefined>): EnvResult {
  const supabaseUrl = raw[URL_KEY];
  const supabasePublishableKey = raw[PUBLISHABLE_KEY_KEY];

  const missing: string[] = [];
  if (!supabaseUrl) missing.push(URL_KEY);
  if (!supabasePublishableKey) missing.push(PUBLISHABLE_KEY_KEY);

  if (!supabaseUrl || !supabasePublishableKey) return { ok: false, missing };
  return { ok: true, env: { supabaseUrl, supabasePublishableKey } };
}

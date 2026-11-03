// Supabase client の単一インスタンス。
// main.tsx が parseEnv の成功を確認してから動的 import する前提で、読み込み時に生成する。
import { createClient } from '@supabase/supabase-js';
import { parseEnv } from './env';

const result = parseEnv(import.meta.env);
if (!result.ok) {
  throw new Error(`設定が不足しています: ${result.missing.join(', ')}`);
}

// 接続 URL と公開キーだけを使う。
export const supabase = createClient(result.env.supabaseUrl, result.env.supabasePublishableKey);

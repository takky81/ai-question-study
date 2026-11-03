// 認証操作（ログイン・ログアウト）とエラーの日本語化。登録操作は提供しない。
import { supabase } from '../../lib/supabase';

export type SignInInput = { email: string; password: string };

type AuthErrorLike = { status?: number; code?: string; message: string };

const INVALID_CREDENTIALS_MESSAGE = 'メールアドレスまたはパスワードが正しくありません';
const NETWORK_FAILURE_MESSAGE = 'ログインできませんでした。通信状況を確認して再度お試しください';
const SIGN_OUT_FAILURE_MESSAGE = 'ログアウトできませんでした。通信状況を確認して再度お試しください';

// Supabase Auth のエラーを画面表示用の文言に変換する。
export function toAuthErrorMessage(error: AuthErrorLike): string {
  if (error.code === 'invalid_credentials' || error.status === 400) {
    return INVALID_CREDENTIALS_MESSAGE;
  }
  // ネットワーク失敗・5xx など、誤認証以外はすべて通信障害として扱う。
  return NETWORK_FAILURE_MESSAGE;
}

// 例外（fetch の失敗など）も AuthErrorLike として扱えるようにする。
function toErrorLike(caught: unknown): AuthErrorLike {
  if (caught && typeof caught === 'object' && 'message' in caught) {
    return caught as AuthErrorLike;
  }
  return { message: String(caught) };
}

// メールアドレスとパスワードでログインする。失敗時は日本語の Error を投げる。
export async function signIn(input: SignInInput): Promise<void> {
  let error: AuthErrorLike | null;
  try {
    ({ error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    }));
  } catch (caught) {
    error = toErrorLike(caught);
  }
  if (error) throw new Error(toAuthErrorMessage(error));
}

// ログアウトする。失敗時は日本語の Error を投げる。
export async function signOut(): Promise<void> {
  let error: unknown;
  try {
    ({ error } = await supabase.auth.signOut());
  } catch (caught) {
    error = caught;
  }
  if (error) throw new Error(SIGN_OUT_FAILURE_MESSAGE);
}

// ログイン後の遷移先を扱う純粋関数。オープンリダイレクトを防ぐため、アプリ内パスだけを許可する。

const LOGIN_PATH = '/login';
const DEFAULT_PATH = '/';

// ログイン画面へのパスを、元のパスを redirect に入れて生成する。
export function buildLoginPath(currentPath: string): string {
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(currentPath)}`;
}

// redirect パラメータを検証し、許可できない値は既定のホームにする。
export function resolveRedirect(param: string | null): string {
  if (!param || !param.startsWith('/')) return DEFAULT_PATH;
  // `//host` と `/\host` はブラウザが外部ホストとして解釈するため拒否する。
  if (param.startsWith('//') || param.startsWith('/\\')) return DEFAULT_PATH;
  // ログイン画面自体へ戻すとループするため拒否する。
  const pathname = (param.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  if (pathname === LOGIN_PATH) return DEFAULT_PATH;
  return param;
}

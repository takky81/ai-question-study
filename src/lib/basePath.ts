// vite.config.ts（Node 側）からも読むため、ブラウザ依存を持たない純粋関数にする。

/** GITHUB_REPOSITORY が未設定のときに使うリポジトリ名。 */
export const DEFAULT_REPOSITORY_NAME = 'ai-question-study';

/**
 * 配信先の base を決める。
 * - 開発サーバー（serve）はルート `/`
 * - ビルド（build）は `owner/name` 形式の name を使った `/<name>/`。未設定時は既定値
 */
export function resolveBase(input: { command: 'build' | 'serve'; repository?: string }): string {
  if (input.command === 'serve') {
    return '/';
  }
  const name = input.repository?.split('/').pop()?.trim();
  return `/${name ? name : DEFAULT_REPOSITORY_NAME}/`;
}

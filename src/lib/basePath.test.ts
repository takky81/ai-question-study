import { describe, expect, it } from 'vitest';
import { DEFAULT_REPOSITORY_NAME, resolveBase } from './basePath';

describe('resolveBase', () => {
  it('開発サーバーではルートを返す', () => {
    expect(resolveBase({ command: 'serve', repository: 'owner/repo' })).toBe('/');
  });

  it('ビルド時は owner/name の name をサブパスにする', () => {
    expect(resolveBase({ command: 'build', repository: 'takakky/my-repo' })).toBe('/my-repo/');
  });

  it('ビルド時にリポジトリ名が未設定なら既定値を使う', () => {
    expect(DEFAULT_REPOSITORY_NAME).toBe('ai-question-study');
    expect(resolveBase({ command: 'build' })).toBe('/ai-question-study/');
    expect(resolveBase({ command: 'build', repository: '' })).toBe('/ai-question-study/');
  });
});

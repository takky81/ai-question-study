import { describe, expect, it } from 'vitest';
import { buildLoginPath, resolveRedirect } from './redirect';

describe('buildLoginPath', () => {
  it('現在のパスをエンコードして redirect に入れる', () => {
    expect(buildLoginPath('/questions?tag=a&b=1')).toBe(
      '/login?redirect=%2Fquestions%3Ftag%3Da%26b%3D1',
    );
  });

  it('生成したパスの redirect を解決すると元のパスに戻る', () => {
    const path = buildLoginPath('/questions/1?x=y#z');
    const param = new URLSearchParams(path.split('?')[1]).get('redirect');
    expect(resolveRedirect(param)).toBe('/questions/1?x=y#z');
  });
});

describe('resolveRedirect', () => {
  it('アプリ内パスはそのまま許可する', () => {
    expect(resolveRedirect('/')).toBe('/');
    expect(resolveRedirect('/settings')).toBe('/settings');
    expect(resolveRedirect('/loginx')).toBe('/loginx');
  });

  it.each([
    null,
    '',
    'https://evil.example.com',
    'http://evil.example.com/path',
    '//evil.example.com',
    '/\\evil.example.com',
    'javascript:alert(1)',
    'questions',
    '/login',
    '/login?redirect=%2Fsettings',
    '/login/',
    '/login#x',
  ])('不正な遷移先 %s はホームに解決する', (param) => {
    expect(resolveRedirect(param)).toBe('/');
  });
});

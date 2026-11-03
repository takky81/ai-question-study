import { describe, expect, it } from 'vitest';
import { parseRangeParams, toRangeParams } from './range';

const S = 'a0000000-0000-4000-8000-000000000001';
const K = 'b0000000-0000-4000-8000-0000000000AB';

describe('toRangeParams', () => {
  it('科目とキーワードを subject、keyword に入れる', () => {
    expect(toRangeParams({ subjectId: S, keywordId: K }).toString()).toBe(`subject=${S}&keyword=${K}`);
  });
  it('科目全体は keyword を含めない', () => {
    expect(toRangeParams({ subjectId: S, keywordId: null }).toString()).toBe(`subject=${S}`);
  });
});

describe('parseRangeParams', () => {
  it('往復で同じ範囲に戻る', () => {
    for (const r of [{ subjectId: S, keywordId: K }, { subjectId: S, keywordId: null }]) {
      expect(parseRangeParams(toRangeParams(r))).toEqual(r);
    }
  });
  it('科目がない、または UUID 形式でなければ null', () => {
    expect(parseRangeParams(new URLSearchParams())).toBeNull();
    expect(parseRangeParams(new URLSearchParams('subject=abc'))).toBeNull();
    expect(parseRangeParams(new URLSearchParams(`keyword=${K}`))).toBeNull();
  });
  it('キーワードが UUID 形式でなければ null', () => {
    expect(parseRangeParams(new URLSearchParams(`subject=${S}&keyword=x`))).toBeNull();
    expect(parseRangeParams(new URLSearchParams(`subject=${S}&keyword=`))).toBeNull();
  });
});

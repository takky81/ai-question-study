import { describe, expect, it } from 'vitest';
import { formatRate, sortBinItems, stemExcerpt } from './items';
import type { BinItem } from './types';

function item(itemId: string, attemptCount: number, correctRate: number | null): BinItem {
  return {
    itemId,
    attemptCount,
    correctCount: correctRate === null ? 0 : Math.round(correctRate * attemptCount),
    correctRate,
    questionCount: null,
    stem: null,
  };
}

describe('sortBinItems', () => {
  it('未出題を先頭に、正答率の昇順、出題数の降順、ID の昇順で並べる', () => {
    const input = [
      item('e', 4, 0.5),
      item('d', 10, 0.5),
      item('c', 2, 0.1),
      item('b', 0, null),
      item('a', 0, null),
      item('f', 10, 0.5),
    ];
    expect(sortBinItems(input).map((i) => i.itemId)).toEqual(['a', 'b', 'c', 'd', 'f', 'e']);
  });

  it('入力を変更せず新しい配列を返す', () => {
    const input = [item('b', 1, 1), item('a', 1, 0)];
    const result = sortBinItems(input);
    expect(result).not.toBe(input);
    expect(input.map((i) => i.itemId)).toEqual(['b', 'a']);
    expect(result.map((i) => i.itemId)).toEqual(['a', 'b']);
  });
});

describe('formatRate', () => {
  it('出題数 0 は「未出題」', () => {
    expect(formatRate({ attemptCount: 0, correctRate: null })).toBe('未出題');
  });
  it('四捨五入した百分率', () => {
    expect(formatRate({ attemptCount: 3, correctRate: 2 / 3 })).toBe('67%');
    expect(formatRate({ attemptCount: 3, correctRate: 1 / 3 })).toBe('33%');
    expect(formatRate({ attemptCount: 200, correctRate: 0.125 })).toBe('13%');
    expect(formatRate({ attemptCount: 1, correctRate: 0 })).toBe('0%');
    expect(formatRate({ attemptCount: 1, correctRate: 1 })).toBe('100%');
  });
});

describe('stemExcerpt', () => {
  it('80 文字以下はそのまま', () => {
    const s = 'あ'.repeat(80);
    expect(stemExcerpt(s)).toBe(s);
    expect(stemExcerpt('')).toBe('');
  });
  it('80 文字を超えると先頭 80 文字と「…」', () => {
    expect(stemExcerpt('a'.repeat(79) + 'bc')).toBe('a'.repeat(79) + 'b…');
  });
  it('サロゲートペアを1文字として数え、途中で切らない', () => {
    const s = '😀'.repeat(81);
    expect(stemExcerpt(s)).toBe('😀'.repeat(80) + '…');
    expect(stemExcerpt('😀'.repeat(80))).toBe('😀'.repeat(80));
  });
});

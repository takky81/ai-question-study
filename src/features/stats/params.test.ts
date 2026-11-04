import { describe, expect, it } from 'vitest';
import { parseStatsParams, toStatsParams, type StatsView } from './params';

const S = '11111111-1111-4111-8111-111111111111';
const K = '22222222-2222-4222-8222-222222222222';

const parse = (q: string) => parseStatsParams(new URLSearchParams(q));

describe('parseStatsParams', () => {
  it('空のパラメータは既定値', () => {
    expect(parse('')).toEqual({ subjectId: null, keywordId: null, target: 'question', selected: null });
  });

  it('全項目を読み取る', () => {
    expect(parse(`subject=${S}&keyword=${K}&target=keyword&metric=attemptCount&bin=3`)).toEqual({
      subjectId: S,
      keywordId: K,
      target: 'keyword',
      selected: { metric: 'attemptCount', bin: 3 },
    });
  });

  it('未出題の区間 -1 を読み取る', () => {
    expect(parse('metric=correctRate&bin=-1').selected).toEqual({ metric: 'correctRate', bin: -1 });
  });

  it('UUID 形式でない subject／keyword は null', () => {
    const v = parse('subject=abc&keyword=1234');
    expect(v.subjectId).toBeNull();
    expect(v.keywordId).toBeNull();
  });

  it('未知の target は question', () => {
    expect(parse('target=foo').target).toBe('question');
  });

  it.each([
    ['metric だけ', 'metric=correctRate'],
    ['bin だけ', 'bin=2'],
    ['未知の metric', 'metric=foo&bin=2'],
    ['小数の bin', 'metric=correctRate&bin=1.5'],
    ['数でない bin', 'metric=correctRate&bin=x'],
    ['空の bin', 'metric=correctRate&bin='],
  ])('%s は selected = null', (_, q) => {
    expect(parse(q).selected).toBeNull();
  });
});

describe('toStatsParams', () => {
  it('既定値は空', () => {
    expect(toStatsParams({ subjectId: null, keywordId: null, target: 'question', selected: null }).toString()).toBe('');
  });

  it.each<StatsView>([
    { subjectId: S, keywordId: K, target: 'keyword', selected: { metric: 'attemptCount', bin: 0 } },
    { subjectId: S, keywordId: null, target: 'question', selected: { metric: 'correctRate', bin: -1 } },
    { subjectId: S, keywordId: null, target: 'keyword', selected: null },
  ])('往復で同じ表示状態に戻る %#', (view) => {
    expect(parseStatsParams(toStatsParams(view))).toEqual(view);
  });

  it('selected を除くと metric と bin が消える', () => {
    const p = toStatsParams({ subjectId: S, keywordId: null, target: 'question', selected: null });
    expect(p.has('metric')).toBe(false);
    expect(p.has('bin')).toBe(false);
    expect(p.get('subject')).toBe(S);
  });
});

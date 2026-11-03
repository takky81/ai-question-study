import { describe, expect, it } from 'vitest';
import { QUESTION_FLAGS } from '@/features/quiz/flags';
import {
  defaultConditions,
  percentToRate,
  rateToPercent,
  toExportFilter,
  toSnapshot,
  validateConditions,
  type ExportConditions,
} from './conditions';

const base = (patch: Partial<ExportConditions> = {}): ExportConditions => ({
  ...defaultConditions('s1'),
  ...patch,
});

const fields = (c: ExportConditions) => validateConditions(c).map((e) => e.field);

describe('defaultConditions', () => {
  it('フラグ条件なし・無効を含めない・統計条件なし', () => {
    expect(defaultConditions('s1')).toEqual({
      subjectId: 's1',
      keywordId: null,
      flag: 'all',
      flagTypes: [],
      correctRateMin: null,
      correctRateMax: null,
      attemptMin: null,
      attemptMax: null,
      attempted: null,
      includeDisabled: false,
    });
    expect(validateConditions(defaultConditions('s1'))).toEqual([]);
  });
});

describe('validateConditions', () => {
  it('正答率の下限 > 上限はエラー（1.10）', () => {
    expect(fields(base({ correctRateMin: 0.8, correctRateMax: 0.2 }))).toEqual(['correctRateMin']);
  });
  it('正答率の下限 = 上限はエラーにしない', () => {
    expect(fields(base({ correctRateMin: 0.5, correctRateMax: 0.5 }))).toEqual([]);
  });
  it('正答率の範囲外（負・1超・非有限）はエラー', () => {
    expect(fields(base({ correctRateMin: -0.01 }))).toEqual(['correctRateMin']);
    expect(fields(base({ correctRateMax: 1.01 }))).toEqual(['correctRateMax']);
    expect(fields(base({ correctRateMin: Number.NaN }))).toEqual(['correctRateMin']);
  });
  it('出題数の下限 > 上限はエラー（1.10）', () => {
    expect(fields(base({ attemptMin: 5, attemptMax: 2 }))).toEqual(['attemptMin']);
  });
  it('負の出題数・整数でない出題数はエラー', () => {
    expect(fields(base({ attemptMin: -1 }))).toEqual(['attemptMin']);
    expect(fields(base({ attemptMax: 1.5 }))).toEqual(['attemptMax']);
  });
  it('範囲外があるときは逆転のエラーを重ねない', () => {
    expect(fields(base({ attemptMin: 5, attemptMax: -1 }))).toEqual(['attemptMax']);
  });
  it('種類条件で種類が空ならエラー、種類があれば通る', () => {
    expect(fields(base({ flag: 'types', flagTypes: [] }))).toEqual(['flagTypes']);
    expect(fields(base({ flag: 'types', flagTypes: [defaultFlag()] }))).toEqual([]);
  });
  it('種類条件以外では種類が空でもエラーにしない', () => {
    expect(fields(base({ flag: 'any' }))).toEqual([]);
  });
  it('メッセージは日本語で返す', () => {
    const [e] = validateConditions(base({ correctRateMin: 0.8, correctRateMax: 0.2 }));
    expect(e?.message).toMatch(/下限/);
  });
});

describe('百分率の変換', () => {
  it('画面の % と内部の 0〜1 を相互に変換する', () => {
    expect(percentToRate(50)).toBe(0.5);
    expect(percentToRate(null)).toBeNull();
    expect(rateToPercent(0.25)).toBe(25);
    expect(rateToPercent(null)).toBeNull();
    expect(rateToPercent(percentToRate(33))).toBe(33);
  });
});

describe('toExportFilter', () => {
  it('RPC の p_filter のキーをちょうど出す', () => {
    const f = toExportFilter(base());
    expect(Object.keys(f).sort()).toEqual(
      [
        'attemptMax',
        'attemptMin',
        'attempted',
        'correctRateMax',
        'correctRateMin',
        'flag',
        'flagTypes',
        'includeDisabled',
      ].sort(),
    );
  });
  it('値をそのまま渡す（正答率は 0〜1）', () => {
    const flagTypes = [defaultFlag()];
    expect(
      toExportFilter(
        base({
          keywordId: 'k1',
          flag: 'types',
          flagTypes,
          correctRateMin: 0.2,
          correctRateMax: 0.9,
          attemptMin: 1,
          attemptMax: 10,
          attempted: true,
          includeDisabled: true,
        }),
      ),
    ).toEqual({
      flag: 'types',
      flagTypes,
      correctRateMin: 0.2,
      correctRateMax: 0.9,
      attemptMin: 1,
      attemptMax: 10,
      attempted: true,
      includeDisabled: true,
    });
  });
  it('種類条件以外では種類を空で渡す', () => {
    expect(toExportFilter(base({ flag: 'any', flagTypes: [defaultFlag()] })).flagTypes).toEqual([]);
  });
});

describe('toSnapshot', () => {
  it('subjectId を除いたスナップショットを作り、戻すと元に戻る', () => {
    const c = base({ keywordId: 'k1', flag: 'none', correctRateMin: 0.1, attempted: false });
    const snap = toSnapshot(c);
    expect(snap).not.toHaveProperty('subjectId');
    expect({ ...snap, subjectId: 's1' }).toEqual(c);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});

function defaultFlag() {
  return QUESTION_FLAGS[0].id;
}

import { describe, expect, it } from 'vitest';
import { applyAnswerToStats, formatCorrectRate, formatRetention } from './stats';
import type { QuestionStats } from './types';

const empty: QuestionStats = { attemptCount: 0, correctCount: 0, correctRate: null, retention: null, lastAnsweredAt: null };

describe('applyAnswerToStats', () => {
  it('正解で出題数と正答数を加え、正答率を再計算する', () => {
    const s = applyAnswerToStats({ ...empty, attemptCount: 2, correctCount: 1, correctRate: 0.5 }, true);
    expect(s).toMatchObject({ attemptCount: 3, correctCount: 2 });
    expect(s.correctRate).toBeCloseTo(2 / 3);
  });

  it('不正解（推測・わからないを含む全種類）でも出題数を数え、正答数は変えない', () => {
    const s = applyAnswerToStats(empty, false);
    expect(s).toMatchObject({ attemptCount: 1, correctCount: 0, correctRate: 0 });
  });

  it('定着率と最終解答日時は変えず、元の値を変更しない', () => {
    const before = { ...empty, retention: 0.8, lastAnsweredAt: '2026-01-01T00:00:00Z' };
    const s = applyAnswerToStats(before, true);
    expect(s.retention).toBe(0.8);
    expect(s.lastAnsweredAt).toBe('2026-01-01T00:00:00Z');
    expect(before.attemptCount).toBe(0);
  });
});

describe('formatCorrectRate', () => {
  it('出題数0は「未出題」', () => {
    expect(formatCorrectRate({ attemptCount: 0, correctRate: null })).toBe('未出題');
  });
  it('百分率を四捨五入して表示する', () => {
    expect(formatCorrectRate({ attemptCount: 3, correctRate: 2 / 3 })).toBe('67%');
    expect(formatCorrectRate({ attemptCount: 1, correctRate: 0 })).toBe('0%');
    expect(formatCorrectRate({ attemptCount: 1, correctRate: 1 })).toBe('100%');
  });
});

describe('formatRetention', () => {
  it('出題数0は「未出題」', () => {
    expect(formatRetention(null, 0)).toBe('未出題');
  });
  it('解答済みで SRS 状態なしは「未評価」', () => {
    expect(formatRetention(null, 2)).toBe('未評価');
  });
  it('百分率を四捨五入して表示する', () => {
    expect(formatRetention(0.814, 3)).toBe('81%');
  });
});

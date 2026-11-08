import { describe, expect, it } from 'vitest';
import { compareCandidates, countCandidates, pickNextCandidate } from './order';
import type { QuizCandidate } from './types';

function c(
  questionId: string,
  over: Partial<QuizCandidate> = {},
): QuizCandidate {
  return {
    questionId,
    createdAt: '2026-01-01T00:00:00Z',
    attemptCount: 0,
    correctCount: 0,
    correctRate: null,
    retention: null,
    lastAnsweredAt: null,
    ...over,
  };
}

function answered(questionId: string, retention: number | null, lastAnsweredAt: string, over: Partial<QuizCandidate> = {}) {
  return c(questionId, { attemptCount: 1, correctCount: 1, correctRate: 1, retention, lastAnsweredAt, ...over });
}

const sorted = (list: QuizCandidate[]) => [...list].sort(compareCandidates).map((x) => x.questionId);

describe('compareCandidates', () => {
  it('未出題を出題済みより先にする', () => {
    expect(sorted([answered('a', 0, '2026-02-01T00:00:00Z'), c('z')])).toEqual(['z', 'a']);
  });

  it('未出題は作成日時の昇順、同時刻は ID の昇順', () => {
    const list = [
      c('b', { createdAt: '2026-01-02T00:00:00Z' }),
      c('y', { createdAt: '2026-01-01T00:00:00Z' }),
      c('x', { createdAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(sorted(list)).toEqual(['x', 'y', 'b']);
  });

  it('出題済みは定着率の低い順', () => {
    const t = '2026-02-01T00:00:00Z';
    expect(sorted([answered('a', 0.9, t), answered('b', 0.1, t), answered('c', 0.5, t)])).toEqual(['b', 'c', 'a']);
  });

  it('定着率 null（「？」のみ）は 0 とみなす', () => {
    const t = '2026-02-01T00:00:00Z';
    expect(sorted([answered('a', 0.01, t), answered('b', null, t, { correctCount: 0, correctRate: 0 })])).toEqual([
      'b',
      'a',
    ]);
    // 0 と null は同値なので最後の解答日時で決まる
    expect(sorted([answered('n', null, '2026-03-01T00:00:00Z'), answered('z', 0, '2026-02-01T00:00:00Z')])).toEqual([
      'z',
      'n',
    ]);
  });

  it('同値は最後の解答日時の昇順、さらに ID の昇順で決定的', () => {
    const list = [
      answered('d', 0.5, '2026-02-02T00:00:00Z'),
      answered('c', 0.5, '2026-02-01T00:00:00Z'),
      answered('b', 0.5, '2026-02-01T00:00:00Z'),
    ];
    expect(sorted(list)).toEqual(['b', 'c', 'd']);
    expect(sorted([...list].reverse())).toEqual(['b', 'c', 'd']);
  });
});

describe('compareCandidates の同率（2.3）', () => {
  const t = '2026-02-01T00:00:00Z';
  const tb = new Map([['a', 0.7], ['b', 0.2], ['c', 0.5]]);
  const sortedBy = (list: QuizCandidate[], tieBreak: ReadonlyMap<string, number>) =>
    [...list].sort((x, y) => compareCandidates(x, y, tieBreak)).map((x) => x.questionId);

  it('未出題の同時刻は乱数の昇順', () => {
    expect(sortedBy([c('a'), c('b'), c('c')], tb)).toEqual(['b', 'c', 'a']);
  });

  it('出題済みの同率・同時刻は乱数の昇順', () => {
    expect(sortedBy([answered('a', 0.5, t), answered('b', 0.5, t), answered('c', 0.5, t)], tb)).toEqual(['b', 'c', 'a']);
  });

  it('未出題優先・作成日時・定着率・最後の解答日時は乱数より優先する', () => {
    const list = [
      answered('a', 0.1, t),
      answered('b', 0.9, t),
      c('c', { createdAt: '2026-01-02T00:00:00Z' }),
      c('d'),
      answered('e', 0.1, '2026-01-15T00:00:00Z'),
    ];
    const rev = new Map([['a', 0.1], ['b', 0.2], ['c', 0.3], ['d', 0.4], ['e', 0.5]]);
    expect(sortedBy(list, rev)).toEqual(['d', 'c', 'e', 'a', 'b']);
  });

  it('乱数が等しいときは ID の昇順（全順序）', () => {
    const same = new Map([['x', 0.3], ['y', 0.3]]);
    expect(sortedBy([c('y'), c('x')], same)).toEqual(['x', 'y']);
  });

  it('pickNextCandidate は乱数を使って同率から選ぶ', () => {
    expect(pickNextCandidate([c('a'), c('b'), c('c')], new Set(), tb)?.questionId).toBe('b');
    expect(pickNextCandidate([c('a'), c('b'), c('c')], new Set(['b']), tb)?.questionId).toBe('c');
  });
});

describe('pickNextCandidate', () => {
  const list = [answered('a', 0.2, '2026-02-01T00:00:00Z'), c('u2', { createdAt: '2026-01-02T00:00:00Z' }), c('u1')];

  it('解答済みを除いた最優先の候補を返す', () => {
    expect(pickNextCandidate(list, new Set())?.questionId).toBe('u1');
    expect(pickNextCandidate(list, new Set(['u1']))?.questionId).toBe('u2');
    expect(pickNextCandidate(list, new Set(['u1', 'u2']))?.questionId).toBe('a');
  });

  it('全件解答済み・候補なしでは null', () => {
    expect(pickNextCandidate(list, new Set(['u1', 'u2', 'a']))).toBeNull();
    expect(pickNextCandidate([], new Set())).toBeNull();
  });

  it('入力を変更しない', () => {
    const input = list.map((x) => ({ ...x }));
    const snapshot = structuredClone(input);
    const ids = new Set(['u1']);
    pickNextCandidate(input, ids);
    countCandidates(input);
    expect(input).toEqual(snapshot);
    expect([...ids]).toEqual(['u1']);
  });
});

describe('countCandidates', () => {
  it('候補数と未出題数を数える', () => {
    expect(countCandidates([c('u1'), c('u2'), answered('a', null, '2026-02-01T00:00:00Z')])).toEqual({
      total: 3,
      unseen: 2,
    });
    expect(countCandidates([])).toEqual({ total: 0, unseen: 0 });
  });
});

describe('compareCandidates の日時比較', () => {
  it('小数秒の桁数が違う作成日時を時刻として比べる', () => {
    const list = [
      c('a', { createdAt: '2026-01-01T00:00:00.5+00:00' }),
      c('b', { createdAt: '2026-01-01T00:00:00.123456+00:00' }),
      c('c', { createdAt: '2026-01-01T00:00:00+00:00' }),
      c('d', { createdAt: '2026-01-01T08:59:59.9+09:00' }), // 2025-12-31T23:59:59.9Z
    ];
    expect(sorted(list)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('小数秒の桁数が違う最後の解答日時を時刻として比べる', () => {
    const list = [
      answered('a', 0.5, '2026-02-01T00:00:00.5+00:00'),
      answered('b', 0.5, '2026-02-01T00:00:00.123456+00:00'),
      answered('c', 0.5, '2026-02-01T00:00:00+00:00'),
      answered('d', 0.5, '2026-02-01T08:59:59.9+09:00'),
    ];
    expect(sorted(list)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('同じミリ秒は ID の昇順', () => {
    const list = [
      c('b', { createdAt: '2026-01-01T00:00:00.1231+00:00' }),
      c('a', { createdAt: '2026-01-01T00:00:00.123+00:00' }),
    ];
    expect(sorted(list)).toEqual(['a', 'b']);
  });

  it('出題済みで最後の解答日時が null の候補は同値の中で先にする', () => {
    const list = [answered('a', 0.5, '2026-02-01T00:00:00+00:00'), c('z', { attemptCount: 1, retention: 0.5 })];
    expect(sorted(list)).toEqual(['z', 'a']);
    expect(sorted([...list].reverse())).toEqual(['z', 'a']);
  });
});

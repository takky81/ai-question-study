import { describe, expect, it } from 'vitest';
import {
  addChoice,
  createDraft,
  fromQuestion,
  isDirty,
  moveChoice,
  removeChoice,
  setCorrect,
} from './draft';
import type { Question, QuestionInput } from './types';

// 既存問題のテスト用データ
function sampleQuestion(): Question {
  return {
    id: 'q1',
    subjectId: 's1',
    kind: 'feature',
    stem: '問題文',
    explanation: '解説',
    keywordIds: ['k1', 'k2'],
    choices: [
      { id: 'c1', body: 'A', explanation: 'a', isCorrect: true },
      { id: 'c2', body: 'B', explanation: 'b', isCorrect: false },
      { id: 'c3', body: 'C', explanation: 'c', isCorrect: false },
      { id: 'c4', body: 'D', explanation: 'd', isCorrect: false },
    ],
    status: 'active',
    disabledReason: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
  };
}

function bodies(d: QuestionInput): string[] {
  return d.choices.map((c) => c.body);
}

describe('createDraft', () => {
  it('キーワードを答える問題は空欄の選択肢を6個持つ', () => {
    const d = createDraft('s1', 'keyword');
    expect(d).toEqual({
      id: null,
      subjectId: 's1',
      kind: 'keyword',
      stem: '',
      explanation: '',
      keywordIds: [],
      choices: Array.from({ length: 6 }, () => ({ id: null, body: '', explanation: '', isCorrect: false })),
    });
  });

  it('特徴などを答える問題は空欄の選択肢を4個持つ', () => {
    const d = createDraft('s1', 'feature');
    expect(d.choices).toHaveLength(4);
    expect(d.choices.every((c) => c.id === null && c.body === '' && !c.isCorrect)).toBe(true);
  });

  it('選択肢は別々のオブジェクトである', () => {
    const d = createDraft('s1', 'feature');
    expect(d.choices[0]).not.toBe(d.choices[1]);
  });
});

describe('fromQuestion', () => {
  it('既存の ID と表示順を保って入力へ変換し、状態などは含めない', () => {
    const q = sampleQuestion();
    const d = fromQuestion(q);
    expect(d).toEqual({
      id: 'q1',
      subjectId: 's1',
      kind: 'feature',
      stem: '問題文',
      explanation: '解説',
      keywordIds: ['k1', 'k2'],
      choices: q.choices,
    });
    expect(d.choices).not.toBe(q.choices);
    expect(d.keywordIds).not.toBe(q.keywordIds);
    d.choices[0]!.body = '変更';
    expect(q.choices[0]!.body).toBe('A');
  });
});

describe('選択肢の操作', () => {
  it('addChoice は ID なしの空欄を末尾に追加する', () => {
    const d = fromQuestion(sampleQuestion());
    const next = addChoice(d);
    expect(next.choices).toHaveLength(5);
    expect(next.choices[4]).toEqual({ id: null, body: '', explanation: '', isCorrect: false });
    expect(d.choices).toHaveLength(4);
  });

  it('removeChoice は指定位置を取り除き、他の ID を保つ', () => {
    const d = fromQuestion(sampleQuestion());
    const next = removeChoice(d, 1);
    expect(next.choices.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);
    expect(d.choices).toHaveLength(4);
  });

  it('removeChoice は範囲外の位置では変化しない', () => {
    const d = fromQuestion(sampleQuestion());
    expect(removeChoice(d, 9)).toEqual(d);
    expect(removeChoice(d, -1)).toEqual(d);
  });

  it('moveChoice は選択肢を移動する', () => {
    const d = fromQuestion(sampleQuestion());
    expect(bodies(moveChoice(d, 0, 2))).toEqual(['B', 'C', 'A', 'D']);
    expect(bodies(moveChoice(d, 3, 0))).toEqual(['D', 'A', 'B', 'C']);
    expect(bodies(d)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('moveChoice は範囲外の位置では変化しない', () => {
    const d = fromQuestion(sampleQuestion());
    expect(moveChoice(d, 0, 4)).toEqual(d);
    expect(moveChoice(d, -1, 0)).toEqual(d);
  });

  it('setCorrect は指定の選択肢だけを正解にする', () => {
    const d = fromQuestion(sampleQuestion());
    const next = setCorrect(d, 2);
    expect(next.choices.map((c) => c.isCorrect)).toEqual([false, false, true, false]);
    expect(d.choices[0]!.isCorrect).toBe(true);
  });

  it('setCorrect は範囲外の位置では変化しない', () => {
    const d = fromQuestion(sampleQuestion());
    expect(setCorrect(d, 4)).toEqual(d);
  });
});

describe('isDirty', () => {
  it('同じ内容なら false', () => {
    const d = fromQuestion(sampleQuestion());
    expect(isDirty(d, fromQuestion(sampleQuestion()))).toBe(false);
  });

  it('キーワードの順序だけの違いは変更とみなさない', () => {
    const d = fromQuestion(sampleQuestion());
    expect(isDirty(d, { ...d, keywordIds: ['k2', 'k1'] })).toBe(false);
  });

  it('各項目の変更を検出する', () => {
    const d = fromQuestion(sampleQuestion());
    expect(isDirty(d, { ...d, stem: '別' })).toBe(true);
    expect(isDirty(d, { ...d, explanation: '別' })).toBe(true);
    expect(isDirty(d, { ...d, kind: 'keyword' })).toBe(true);
    expect(isDirty(d, { ...d, keywordIds: ['k1'] })).toBe(true);
    expect(isDirty(d, addChoice(d))).toBe(true);
    expect(isDirty(d, removeChoice(d, 0))).toBe(true);
    expect(isDirty(d, moveChoice(d, 0, 1))).toBe(true);
    expect(isDirty(d, setCorrect(d, 1))).toBe(true);
    const edited = { ...d, choices: d.choices.map((c, i) => (i === 0 ? { ...c, explanation: 'x' } : c)) };
    expect(isDirty(d, edited)).toBe(true);
  });
});

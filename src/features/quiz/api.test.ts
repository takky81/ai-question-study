import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: mock }));

import {
  getQuizQuestion,
  listOpenFlags,
  listQuizCandidates,
  listQuizSubjects,
  listSubjectKeywords,
  recordAnswer,
  saveQuestionFlags,
  toQuizErrorMessage,
} from './api';

type Result = { data?: unknown; error?: unknown };

// クエリビルダーのモック。呼ばれたメソッドと引数を記録し、await で result を返す。
function builder(result: Result) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'range', 'single', 'maybeSingle']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve({ data: null, error: null, ...result }).then(resolve, reject);
  return { b, calls };
}

beforeEach(() => {
  mock.from.mockReset();
  mock.rpc.mockReset();
});

const statsRowWithNulls = {
  attempt_count: 0,
  correct_count: 0,
  correct_rate: null,
  retention: null,
  last_answered_at: null,
};

describe('toQuizErrorMessage', () => {
  it('question_not_servable は出題対象外の文言にする', () => {
    expect(
      toQuizErrorMessage('解答の記録', { code: 'P0001', message: 'question_not_servable' }),
    ).toBe('この問題は出題対象ではなくなりました');
  });

  it('choice_not_in_question は選択肢なしの文言にする', () => {
    expect(
      toQuizErrorMessage('解答の記録', { code: 'P0001', message: 'choice_not_in_question' }),
    ).toBe('選択肢が見つかりません。問題を読み込み直してください');
  });

  it('その他は操作の文脈を付ける', () => {
    expect(toQuizErrorMessage('フラグの保存', { code: '42501', message: 'denied' })).toBe(
      'フラグの保存に失敗しました: denied',
    );
    expect(toQuizErrorMessage('解答の記録', { message: 'question_not_servable' })).toBe(
      '解答の記録に失敗しました: question_not_servable',
    );
  });
});

describe('listQuizSubjects / listSubjectKeywords', () => {
  it('未削除の科目を名前順で変換する', async () => {
    const { b, calls } = builder({ data: [{ id: 's1', name: 'A', created_at: 't' }] });
    mock.from.mockReturnValue(b);
    expect(await listQuizSubjects()).toEqual([{ id: 's1', name: 'A', createdAt: 't' }]);
    expect(calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(calls).toContainEqual(['order', ['name']]);
  });

  it('科目の取得失敗は文脈付きのメッセージで投げる', async () => {
    mock.from.mockReturnValue(builder({ error: { message: 'boom' } }).b);
    await expect(listQuizSubjects()).rejects.toThrow('科目の取得に失敗しました: boom');
  });

  it('キーワードを sort_order, id 順で全件取得する', async () => {
    const { b, calls } = builder({
      data: [{ id: 'k1', subject_id: 's1', parent_id: null, name: 'K', sort_order: 0 }],
    });
    mock.from.mockReturnValue(b);
    expect(await listSubjectKeywords('s1')).toEqual([
      { id: 'k1', subjectId: 's1', parentId: null, name: 'K', sortOrder: 0 },
    ]);
    expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['sort_order', 'id']);
    expect(calls).toContainEqual(['range', [0, 999]]);
  });
});

describe('listQuizCandidates', () => {
  it('RPC を範囲で呼び、null を含む行を変換し、1,000 件超を連結する', async () => {
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        question_id: `q${offset + i}`,
        created_at: 't',
        ...statsRowWithNulls,
      }));
    const first = builder({ data: page(1000, 0) });
    const second = builder({ data: page(5, 1000) });
    mock.rpc.mockReturnValueOnce(first.b).mockReturnValueOnce(second.b);
    const result = await listQuizCandidates({ subjectId: 's1', keywordId: null });
    expect(result).toHaveLength(1005);
    expect(result[0]).toEqual({
      questionId: 'q0',
      createdAt: 't',
      attemptCount: 0,
      correctCount: 0,
      correctRate: null,
      retention: null,
      lastAnsweredAt: null,
    });
    expect(result[1004]?.questionId).toBe('q1004');
    expect(mock.rpc).toHaveBeenCalledWith('list_quiz_candidates', {
      p_subject_id: 's1',
      p_keyword_id: null,
    });
    expect(first.calls).toContainEqual(['range', [0, 999]]);
    expect(second.calls).toContainEqual(['range', [1000, 1999]]);
    // 安定した一意の順序
    expect(first.calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual([
      'created_at',
      'question_id',
    ]);
  });

  it('取得失敗は文脈付きで投げる', async () => {
    mock.rpc.mockReturnValue(builder({ error: { message: 'x' } }).b);
    await expect(listQuizCandidates({ subjectId: 's1', keywordId: 'k1' })).rejects.toThrow(
      '出題候補の取得に失敗しました: x',
    );
  });
});

describe('getQuizQuestion', () => {
  function setup(question: unknown, stats: unknown, error: unknown = null) {
    const tables: Record<string, Result> = {
      servable_questions: { data: question, error },
      choices: {
        data: [
          { id: 'c1', body: 'B1', explanation: 'E1', is_correct: true, position: 1 },
          { id: 'c2', body: 'B2', explanation: 'E2', is_correct: false, position: 2 },
        ],
      },
      question_keywords: { data: [{ keyword_id: 'k1' }] },
      question_stats: { data: stats },
    };
    const calls: Record<string, [string, unknown[]][]> = {};
    mock.from.mockImplementation((t: string) => {
      const { b, calls: c } = builder(tables[t] ?? {});
      calls[t] = c;
      return b;
    });
    return calls;
  }

  it('出題対象・有効な選択肢・紐づけ・成績を変換する（isCorrect を含む、成績なしは null）', async () => {
    const calls = setup(
      { id: 'q1', subject_id: 's1', kind: 'single', stem: 'S', explanation: 'X' },
      null,
    );
    expect(await getQuizQuestion('q1')).toEqual({
      id: 'q1',
      subjectId: 's1',
      kind: 'single',
      stem: 'S',
      explanation: 'X',
      keywordIds: ['k1'],
      choices: [
        { id: 'c1', body: 'B1', explanation: 'E1', isCorrect: true },
        { id: 'c2', body: 'B2', explanation: 'E2', isCorrect: false },
      ],
      stats: {
        attemptCount: 0,
        correctCount: 0,
        correctRate: null,
        retention: null,
        lastAnsweredAt: null,
      },
    });
    expect(calls.choices).toContainEqual(['is', ['removed_at', null]]);
    expect(calls.choices).toContainEqual(['order', ['position']]);
  });

  it('成績の行があれば変換する', async () => {
    setup(
      { id: 'q1', subject_id: 's1', kind: 'single', stem: 'S', explanation: 'X' },
      { attempt_count: 2, correct_count: 1, correct_rate: 0.5, retention: 0.9, last_answered_at: 't' },
    );
    expect((await getQuizQuestion('q1'))?.stats).toEqual({
      attemptCount: 2,
      correctCount: 1,
      correctRate: 0.5,
      retention: 0.9,
      lastAnsweredAt: 't',
    });
  });

  it('出題対象外は null', async () => {
    setup(null, null);
    expect(await getQuizQuestion('q1')).toBeNull();
  });

  it('取得失敗は文脈付きで投げる', async () => {
    setup(null, null, { message: 'down' });
    await expect(getQuizQuestion('q1')).rejects.toThrow('問題の取得に失敗しました: down');
  });
});

describe('recordAnswer', () => {
  const row = {
    answer_id: 'a1',
    is_correct: false,
    correct_choice_id: 'c1',
    attempt_count: 1,
    correct_count: 0,
    correct_rate: 0,
    retention: null,
    last_answered_at: 't',
    already_recorded: false,
  };

  it('引数を RPC に渡し、結果（配列でも単一でも）を変換する', async () => {
    mock.rpc.mockResolvedValueOnce({ data: [row], error: null });
    const result = await recordAnswer({
      clientAnswerId: 'u1',
      questionId: 'q1',
      choiceId: null,
      kind: 'unknown',
    });
    expect(mock.rpc).toHaveBeenCalledWith('record_answer', {
      p_client_answer_id: 'u1',
      p_question_id: 'q1',
      p_choice_id: null,
      p_kind: 'unknown',
    });
    expect(result).toEqual({
      answerId: 'a1',
      isCorrect: false,
      correctChoiceId: 'c1',
      attemptCount: 1,
      correctCount: 0,
      correctRate: 0,
      retention: null,
      lastAnsweredAt: 't',
      alreadyRecorded: false,
    });
    mock.rpc.mockResolvedValueOnce({ data: row, error: null });
    const single = await recordAnswer({
      clientAnswerId: 'u1',
      questionId: 'q1',
      choiceId: 'c1',
      kind: 'normal',
    });
    expect(single.answerId).toBe('a1');
  });

  it('出題対象外のエラーを日本語にする', async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'question_not_servable' },
    });
    await expect(
      recordAnswer({ clientAnswerId: 'u', questionId: 'q', choiceId: 'c', kind: 'normal' }),
    ).rejects.toThrow('この問題は出題対象ではなくなりました');
  });
});

describe('フラグ', () => {
  it('未解消のフラグとコメントを返す', async () => {
    const { b, calls } = builder({
      data: [
        { flag: 'guessable', note: null },
        { flag: 'comment', note: '疑義' },
        { flag: 'defective', note: null },
      ],
    });
    mock.from.mockReturnValue(b);
    expect(await listOpenFlags('q1')).toEqual({
      flags: ['guessable', 'defective'],
      comment: '疑義',
    });
    expect(calls).toContainEqual(['eq', ['status', 'open']]);
  });

  it('コメントがなければ null', async () => {
    mock.from.mockReturnValue(builder({ data: [] }).b);
    expect(await listOpenFlags('q1')).toEqual({ flags: [], comment: null });
  });

  it('保存前にコメントを正規化する（全角空白・改行だけなら null）', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    await saveQuestionFlags('q1', ['low_value'], '　 \n');
    expect(mock.rpc).toHaveBeenCalledWith('save_question_flags', {
      p_question_id: 'q1',
      p_flags: ['low_value'],
      p_comment: null,
    });
    await saveQuestionFlags('q1', [], '  内容 ');
    expect(mock.rpc).toHaveBeenLastCalledWith('save_question_flags', {
      p_question_id: 'q1',
      p_flags: [],
      p_comment: '内容',
    });
  });

  it('保存失敗は文脈付きで投げる', async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'question_not_found' },
    });
    await expect(saveQuestionFlags('q1', [], '')).rejects.toThrow(
      'フラグの保存に失敗しました: question_not_found',
    );
  });
});

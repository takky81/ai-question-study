import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: mock }));

import {
  applyImport,
  countExportQuestions,
  fetchExportRows,
  listExportSubjects,
  listSubjectKeywords,
  loadImportSnapshot,
  StalePreviewError,
  toExchangeErrorMessage,
} from './api';
import { defaultConditions } from './conditions';
import { EXCHANGE_FORMAT, type ImportFileV1 } from './format';
import type { ApplyPayload } from './plan';

type Result = { data?: unknown; error?: unknown; count?: number | null };
type Calls = [string, unknown[]][];

// クエリビルダーのモック。呼ばれたメソッドと引数を記録し、await で result を返す。
function builder(result: Result | ((calls: Calls) => Result)) {
  const calls: Calls = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'range', 'maybeSingle']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    const r = typeof result === 'function' ? result(calls) : result;
    return Promise.resolve({ data: null, error: null, ...r }).then(resolve, reject);
  };
  return { b, calls };
}

const S = 'c0000000-0000-4000-8000-000000000001';
const K1 = 'a0000000-0000-4000-8000-000000000001';
const K2 = 'a0000000-0000-4000-8000-000000000002';
const KF = 'a0000000-0000-4000-8000-0000000000ff';
const qid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  mock.from.mockReset();
  mock.rpc.mockReset();
});

describe('toExchangeErrorMessage', () => {
  it.each([
    [{ code: 'P0001', message: 'stale_preview' }, 'プレビューの作成後にデータが変更されました。再検証してください'],
    [{ code: 'P0001', message: 'keyword_cycle' }, 'キーワードを自分自身または配下へは移動できません'],
    [{ code: '23505', message: 'dup' }, '同じ親の下に同じ名前のキーワードがあります'],
    [{ code: 'P0001', message: 'one_correct_required' }, '正解は1つにしてください'],
  ])('%o を専用の文言にする', (error, expected) => {
    expect(toExchangeErrorMessage('取込の適用', error)).toBe(expected);
  });

  it.each(['keyword_not_found', 'question_not_found', 'temp_key_unresolved'])(
    '未対応の P0001 %s は文脈付きの汎用文言にする',
    (code) => {
      expect(toExchangeErrorMessage('取込の適用', { code: 'P0001', message: code })).toBe(
        `取込の適用に失敗しました: ${code}`,
      );
    },
  );

  it('コードのない失敗も汎用文言にする', () => {
    expect(toExchangeErrorMessage('出力', { message: 'Failed to fetch' })).toBe('出力に失敗しました: Failed to fetch');
  });
});

describe('listExportSubjects / listSubjectKeywords', () => {
  it('削除されていない科目を名前順で返す', async () => {
    const { b, calls } = builder({ data: [{ id: S, name: '科目' }] });
    mock.from.mockReturnValue(b);
    await expect(listExportSubjects()).resolves.toEqual([{ id: S, name: '科目' }]);
    expect(mock.from).toHaveBeenCalledWith('subjects');
    expect(calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['name', 'id']);
  });

  it('科目の取得失敗は日本語のエラーにする', async () => {
    mock.from.mockReturnValue(builder({ error: { message: 'boom' } }).b);
    await expect(listExportSubjects()).rejects.toThrow('科目の取得に失敗しました: boom');
  });

  it('キーワードを camelCase に変換し sort_order, id 順で取る', async () => {
    const { b, calls } = builder({
      data: [{ id: K1, subject_id: S, parent_id: null, name: 'A', sort_order: 0 }],
    });
    mock.from.mockReturnValue(b);
    await expect(listSubjectKeywords(S)).resolves.toEqual([
      { id: K1, subjectId: S, parentId: null, name: 'A', sortOrder: 0 },
    ]);
    expect(calls).toContainEqual(['eq', ['subject_id', S]]);
    expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['sort_order', 'id']);
    expect(calls).toContainEqual(['range', [0, 999]]);
  });
});

describe('countExportQuestions', () => {
  it('keywordId を p_keyword_id に別で渡し、行を返さない件数を返す', async () => {
    mock.rpc.mockReturnValue(builder({ count: 42 }).b);
    const c = { ...defaultConditions(S), keywordId: K1 };
    await expect(countExportQuestions(c)).resolves.toBe(42);
    const [name, args, opts] = mock.rpc.mock.calls[0]!;
    expect(name).toBe('export_questions');
    expect(args.p_subject_id).toBe(S);
    expect(args.p_keyword_id).toBe(K1);
    expect(args.p_filter).not.toHaveProperty('keywordId');
    expect(opts).toEqual({ count: 'exact', head: true });
  });

  it('失敗は文脈付きのエラーにする', async () => {
    mock.rpc.mockReturnValue(builder({ error: { message: 'x' } }).b);
    await expect(countExportQuestions(defaultConditions(S))).rejects.toThrow('件数の取得に失敗しました: x');
  });
});

describe('fetchExportRows', () => {
  function setupExport(overrides: Partial<Record<string, Result | ((calls: Calls) => Result)>> = {}) {
    const fromCalls: Record<string, Calls> = {};
    const rpcCalls: Record<string, Calls> = {};
    mock.from.mockImplementation((table: string) => {
      const defaults: Record<string, Result> = {
        subjects: { data: { id: S, name: '科目' } },
        keywords: { data: [{ id: K1, subject_id: S, parent_id: null, name: 'A', sort_order: 0 }] },
        keyword_stats: {
          data: [{ keyword_id: K1, question_count: 1, attempt_count: 4, correct_count: 3, correct_rate: 0.75 }],
        },
      };
      const { b, calls } = builder(overrides[table] ?? defaults[table]!);
      fromCalls[table] = calls;
      return b;
    });
    mock.rpc.mockImplementation((name: string) => {
      const defaults: Record<string, Result | ((calls: Calls) => Result)> = {
        export_questions: {
          data: [
            {
              id: qid(1),
              kind: 'keyword',
              stem: '問',
              explanation: '解',
              disabled_at: null,
              disabled_reason: null,
              created_at: '2026-01-01T00:00:00.123456+00:00',
              updated_at: '2026-01-02T00:00:00.123456+00:00',
              keyword_ids: [K1],
              attempt_count: 4,
              correct_count: 3,
              correct_rate: 0.75,
              retention: null,
            },
          ],
        },
        export_choices: {
          data: [{ question_id: qid(1), id: 'c1', position: 0, body: 'b', explanation: 'e', is_correct: true }],
        },
        export_flags: {
          data: [{ id: 'f1', question_id: qid(1), flag: 'comment', note: 'n', created_at: '2026-01-03T00:00:00Z' }],
        },
      };
      const { b, calls } = builder(overrides[name] ?? defaults[name]!);
      rpcCalls[name] = calls;
      return b;
    });
    return { fromCalls, rpcCalls };
  }

  it('各行を camelCase の ExportRows に変換する', async () => {
    setupExport();
    const rows = await fetchExportRows({ ...defaultConditions(S), keywordId: K1 });
    expect(rows.subject).toEqual({ id: S, name: '科目' });
    expect(rows.keywords).toEqual([{ id: K1, parentId: null, name: 'A', sortOrder: 0 }]);
    expect(rows.keywordStats).toEqual([
      { keywordId: K1, questionCount: 1, attemptCount: 4, correctCount: 3, correctRate: 0.75 },
    ]);
    expect(rows.questions[0]).toEqual({
      id: qid(1),
      kind: 'keyword',
      stem: '問',
      explanation: '解',
      disabledAt: null,
      disabledReason: null,
      createdAt: '2026-01-01T00:00:00.123456+00:00',
      updatedAt: '2026-01-02T00:00:00.123456+00:00',
      keywordIds: [K1],
      attemptCount: 4,
      correctCount: 3,
      correctRate: 0.75,
      retention: null,
    });
    expect(rows.choices).toEqual([
      { questionId: qid(1), id: 'c1', position: 0, body: 'b', explanation: 'e', isCorrect: true },
    ]);
    expect(rows.flags).toEqual([
      { id: 'f1', questionId: qid(1), flag: 'comment', note: 'n', createdAt: '2026-01-03T00:00:00Z' },
    ]);
    for (const name of ['export_questions', 'export_choices', 'export_flags']) {
      const call = mock.rpc.mock.calls.find(([n]) => n === name)!;
      expect(call[1].p_keyword_id).toBe(K1);
      expect(call[1].p_subject_id).toBe(S);
    }
  });

  it('クライアントの並び順をサーバーの順序に合わせてページングする', async () => {
    const { fromCalls, rpcCalls } = setupExport();
    await fetchExportRows(defaultConditions(S));
    const orders = (c: Calls) => c.filter(([m]) => m === 'order').map(([, a]) => a[0]);
    expect(orders(rpcCalls.export_questions!)).toEqual(['created_at', 'id']);
    expect(orders(rpcCalls.export_choices!)).toEqual(['question_id', 'position']);
    expect(orders(rpcCalls.export_flags!)).toEqual(['question_id', 'created_at', 'id']);
    expect(orders(fromCalls.keyword_stats!)).toEqual(['keyword_id']);
    expect(fromCalls.keyword_stats!).toContainEqual(['eq', ['subject_id', S]]);
  });

  it('1,000 件を超える問題を欠落・重複なく取り切る', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => ({
      id: qid(i),
      kind: 'keyword',
      stem: 's',
      explanation: 'e',
      disabled_at: null,
      disabled_reason: null,
      created_at: 't',
      updated_at: 't',
      keyword_ids: [],
      attempt_count: 0,
      correct_count: 0,
      correct_rate: null,
      retention: null,
    }));
    setupExport({
      export_questions: (calls) => {
        const [from, to] = calls.find(([m]) => m === 'range')![1] as [number, number];
        return { data: all.slice(from, to + 1) };
      },
    });
    const rows = await fetchExportRows(defaultConditions(S));
    expect(rows.questions.map((q) => q.id)).toEqual(all.map((q) => q.id));
  });

  it('1つでも失敗すれば全体を失敗させる', async () => {
    setupExport({ export_flags: { error: { message: 'boom' } } });
    await expect(fetchExportRows(defaultConditions(S))).rejects.toThrow('フラグの取得に失敗しました: boom');
  });

  it('科目がなければ失敗させる', async () => {
    setupExport({ subjects: { data: null } });
    await expect(fetchExportRows(defaultConditions(S))).rejects.toThrow('科目が見つかりません');
  });
});

function importFile(partial: Partial<ImportFileV1['questions']> = {}, keywords?: ImportFileV1['keywords']): ImportFileV1 {
  return {
    format: EXCHANGE_FORMAT.import,
    version: 1,
    subjectId: S,
    basedOnExportedAt: null,
    keywords: keywords ?? { add: [], rename: [], move: [] },
    questions: { update: [], create: [], disable: [], ...partial },
  };
}

describe('loadImportSnapshot', () => {
  type Handler = (calls: Calls) => Result;
  function setupImport(handlers: Partial<Record<string, Handler>> = {}) {
    const log: Record<string, Calls[]> = {};
    mock.from.mockImplementation((table: string) => {
      const defaults: Record<string, Handler> = {
        subjects: () => ({ data: { id: S, name: '科目', deleted_at: null } }),
        keywords: () => ({
          data: [
            { id: K1, subject_id: S, parent_id: null, name: 'A', sort_order: 0, updated_at: '2026-01-01T00:00:00.123456+00:00' },
            { id: K2, subject_id: S, parent_id: K1, name: 'B', sort_order: 0, updated_at: '2026-01-01T00:00:00.654321+00:00' },
          ],
        }),
        questions: (calls) => {
          const ids = calls.find(([m]) => m === 'in')![1][1] as string[];
          return {
            data: ids.map((id) => ({
              id,
              subject_id: S,
              kind: 'keyword',
              stem: 's',
              explanation: 'e',
              disabled_at: id === qid(2) ? 't' : null,
              deleted_at: id === qid(3) ? 't' : null,
              updated_at: '2026-02-01T00:00:00.000001+00:00',
            })),
          };
        },
        choices: (calls) => {
          const ids = calls.find(([m]) => m === 'in')![1][1] as string[];
          return {
            data: ids.flatMap((id) => [
              { id: `${id}-c0`, question_id: id, position: 0, body: 'b0', explanation: 'e0', is_correct: true },
              { id: `${id}-c1`, question_id: id, position: 1, body: 'b1', explanation: 'e1', is_correct: false },
            ]),
          };
        },
        question_keywords: (calls) => {
          const ids = calls.find(([m]) => m === 'in')![1][1] as string[];
          return { data: ids.map((id) => ({ question_id: id, keyword_id: K2 })) };
        },
        question_flags: (calls) => {
          const ids = calls.find(([m]) => m === 'in')![1][1] as string[];
          return {
            data: ids
              .filter((id) => id === qid(1))
              .map((id) => ({ id: 'f', question_id: id, flag: 'comment', note: 'n', created_at: '2026-03-01T00:00:00Z' })),
          };
        },
      };
      const { b, calls } = builder((c) => (handlers[table] ?? defaults[table])!(c));
      (log[table] ??= []).push(calls);
      return b;
    });
    return log;
  }

  const body = { kind: 'keyword' as const, stem: 's', explanation: 'e', keywords: [{ id: K2 }], choices: [] };

  it('科目・キーワード・参照された問題をスナップショットにし、updated_at を加工しない', async () => {
    const log = setupImport();
    const snap = await loadImportSnapshot(
      importFile({
        update: [{ id: qid(1), ...body }, { id: qid(3), ...body }],
        disable: [{ id: qid(2), reason: null }],
      }),
    );
    expect(snap.subject).toEqual({ id: S, name: '科目', deleted: false });
    expect(snap.keywords).toEqual([
      { id: K1, subjectId: S, parentId: null, name: 'A', sortOrder: 0, updatedAt: '2026-01-01T00:00:00.123456+00:00' },
      { id: K2, subjectId: S, parentId: K1, name: 'B', sortOrder: 0, updatedAt: '2026-01-01T00:00:00.654321+00:00' },
    ]);
    expect(snap.questions.get(qid(1))).toEqual({
      id: qid(1),
      subjectId: S,
      kind: 'keyword',
      stem: 's',
      explanation: 'e',
      keywordIds: [K2],
      choices: [
        { id: `${qid(1)}-c0`, body: 'b0', explanation: 'e0', isCorrect: true },
        { id: `${qid(1)}-c1`, body: 'b1', explanation: 'e1', isCorrect: false },
      ],
      status: 'active',
      updatedAt: '2026-02-01T00:00:00.000001+00:00',
    });
    expect(snap.questions.get(qid(2))!.status).toBe('disabled');
    expect(snap.questions.get(qid(3))!.status).toBe('deleted');
    expect(snap.openFlags.get(qid(1))).toEqual([{ flag: 'comment', note: 'n', createdAt: '2026-03-01T00:00:00Z' }]);
    expect(snap.openFlags.has(qid(2))).toBe(false);
    expect(snap.foreignKeywordIds.size).toBe(0);
    // 問題は削除済みを含めて取る（deleted_at で絞らない）、選択肢は有効なものだけ、フラグは未解消だけ
    expect(log.questions![0]!.some(([m, a]) => m === 'is' && a[0] === 'deleted_at')).toBe(false);
    expect(log.choices![0]).toContainEqual(['is', ['removed_at', null]]);
    expect(log.question_flags![0]).toContainEqual(['eq', ['status', 'open']]);
    expect(log.keywords![0]).toContainEqual(['eq', ['subject_id', S]]);
  });

  it('参照された問題 ID を重複なく 100 件ずつに分けて取得する', async () => {
    const log = setupImport();
    const update = Array.from({ length: 201 }, (_, i) => ({ id: qid(i + 10), ...body }));
    const snap = await loadImportSnapshot(importFile({ update, disable: [{ id: qid(10), reason: null }] }));
    const chunkSizes = log.questions!.map((c) => (c.find(([m]) => m === 'in')![1][1] as string[]).length);
    expect(chunkSizes).toEqual([100, 100, 1]);
    expect(log.choices!.length).toBe(3);
    expect(log.question_keywords!.length).toBe(3);
    expect(log.question_flags!.length).toBe(3);
    expect(snap.questions.size).toBe(201);
  });

  it('ちょうど 100 件は1回で取得し、参照がなければ問題を問い合わせない', async () => {
    let log = setupImport();
    await loadImportSnapshot(importFile({ update: Array.from({ length: 100 }, (_, i) => ({ id: qid(i), ...body })) }));
    expect(log.questions!.length).toBe(1);
    log = setupImport();
    const snap = await loadImportSnapshot(importFile());
    expect(log.questions).toBeUndefined();
    expect(snap.questions.size).toBe(0);
  });

  it('科目外・不存在のキーワード ID を foreignKeywordIds に入れる', async () => {
    setupImport();
    const snap = await loadImportSnapshot(
      importFile(
        { create: [{ ...body, keywords: [{ id: KF }, { tempKey: 't' }], choices: [] }] },
        {
          add: [{ tempKey: 't', parent: { id: K1 }, name: 'N' }],
          rename: [{ id: K2, name: 'R' }],
          move: [{ id: 'zz-not-uuid', parent: null }],
        },
      ),
    );
    expect([...snap.foreignKeywordIds].sort()).toEqual([KF, 'zz-not-uuid'].sort());
  });

  it('UUID でない問題 ID は問い合わせず、存在しないものとして扱う', async () => {
    const log = setupImport();
    const snap = await loadImportSnapshot(importFile({ disable: [{ id: 'not-a-uuid', reason: null }] }));
    expect(log.questions).toBeUndefined();
    expect(snap.questions.has('not-a-uuid')).toBe(false);
  });

  it('科目が削除済みなら deleted、見つからなければ null にする', async () => {
    setupImport({ subjects: () => ({ data: { id: S, name: '科目', deleted_at: 't' } }) });
    expect((await loadImportSnapshot(importFile())).subject).toEqual({ id: S, name: '科目', deleted: true });
    setupImport({ subjects: () => ({ data: null }) });
    expect((await loadImportSnapshot(importFile())).subject).toBeNull();
  });

  it('取得の失敗は全体の失敗にする', async () => {
    setupImport({ choices: () => ({ error: { message: 'boom' } }) });
    await expect(loadImportSnapshot(importFile({ update: [{ id: qid(1), ...body }] }))).rejects.toThrow(
      '選択肢の取得に失敗しました: boom',
    );
  });
});

describe('applyImport', () => {
  const payload: ApplyPayload = {
    subjectId: S,
    expected: { keywords: [], questions: [] },
    keywordAdds: [],
    keywordRenames: [],
    keywordMoves: [],
    questionUpdates: [],
    questionCreates: [],
    questionDisables: [],
    modifiedQuestionIds: [],
  };

  it('適用 RPC にペイロードを渡し結果を返す', async () => {
    const result = {
      keywordIds: { t: K1 },
      questionIds: {},
      counts: {
        keywordsAdded: 1,
        keywordsRenamed: 0,
        keywordsMoved: 0,
        questionsUpdated: 0,
        questionsCreated: 0,
        questionsDisabled: 0,
      },
      resolvedFlagCount: 2,
    };
    mock.rpc.mockResolvedValue({ data: result, error: null });
    await expect(applyImport(payload)).resolves.toEqual(result);
    expect(mock.rpc).toHaveBeenCalledWith('apply_exchange_import', { p: payload });
  });

  it('stale_preview は StalePreviewError にする', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_preview' } });
    const e = await applyImport(payload).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StalePreviewError);
    expect((e as Error).message).toBe('プレビューの作成後にデータが変更されました。再検証してください');
  });

  it('その他の失敗は文脈付きの日本語のエラーにする', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'question_not_found' } });
    const e = await applyImport(payload).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(StalePreviewError);
    expect((e as Error).message).toBe('取込の適用に失敗しました: question_not_found');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: mock }));

import { getHistograms, listBinItems, listStatsKeywords, listStatsSubjects, toStatsErrorMessage } from './api';

type Result = { data?: unknown; error?: unknown };

// クエリビルダーのモック。呼ばれたメソッドと引数を記録し、await で result を返す。
function builder(result: Result) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'range']) {
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

const SUBJECT = 'd0000000-0000-4000-8000-000000000001';
const KEYWORD = 'd0000000-0000-4000-8000-000000000002';

describe('toStatsErrorMessage', () => {
  it('操作の文脈を付ける', () => {
    expect(toStatsErrorMessage('科目の取得', { message: 'boom' })).toBe('科目の取得に失敗しました: boom');
  });
  it('既知の例外を日本語にする', () => {
    expect(toStatsErrorMessage('区間の一覧の取得', { message: 'invalid_stats_target' })).toBe(
      '区間の一覧の取得に失敗しました: 集計対象の指定が正しくありません',
    );
    expect(toStatsErrorMessage('区間の一覧の取得', { message: 'invalid_stats_metric' })).toBe(
      '区間の一覧の取得に失敗しました: 指標の指定が正しくありません',
    );
  });
});

describe('listStatsSubjects', () => {
  it('未削除の科目を名前・ID 順で取得して変換する', async () => {
    const { b, calls } = builder({ data: [{ id: SUBJECT, name: '統計検証', created_at: '2026-01-01T00:00:00Z' }] });
    mock.from.mockReturnValue(b);
    await expect(listStatsSubjects()).resolves.toEqual([
      { id: SUBJECT, name: '統計検証', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(mock.from).toHaveBeenCalledWith('subjects');
    expect(calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(calls.filter(([m]) => m === 'order')).toEqual([
      ['order', ['name']],
      ['order', ['id']],
    ]);
  });
  it('失敗は文脈付きの Error にする', async () => {
    mock.from.mockReturnValue(builder({ error: { message: 'boom' } }).b);
    await expect(listStatsSubjects()).rejects.toThrow('科目の取得に失敗しました: boom');
  });
});

describe('listStatsKeywords', () => {
  it('科目のキーワードを sort_order, id 順で取得して変換する', async () => {
    const { b, calls } = builder({
      data: [{ id: KEYWORD, subject_id: SUBJECT, parent_id: null, name: '親', sort_order: 1 }],
    });
    mock.from.mockReturnValue(b);
    await expect(listStatsKeywords(SUBJECT)).resolves.toEqual([
      { id: KEYWORD, subjectId: SUBJECT, parentId: null, name: '親', sortOrder: 1 },
    ]);
    expect(calls).toContainEqual(['eq', ['subject_id', SUBJECT]]);
    expect(calls).toContainEqual(['range', [0, 999]]);
  });
});

describe('getHistograms', () => {
  it('RPC の行の指標名を変換して組み立てる', async () => {
    mock.rpc.mockResolvedValue({
      data: [
        { target: 'question', metric: 'correct_rate', bin: -1, item_count: 2 },
        { target: 'question', metric: 'correct_rate', bin: 9, item_count: 3 },
        { target: 'question', metric: 'attempt_count', bin: 0, item_count: 2 },
        { target: 'keyword', metric: 'attempt_count', bin: 1, item_count: 4 },
      ],
      error: null,
    });
    const h = await getHistograms(SUBJECT, null);
    expect(mock.rpc).toHaveBeenCalledWith('stats_histograms', { p_subject_id: SUBJECT, p_keyword_id: null });
    expect(h.question.correctRate.unattempted).toBe(2);
    expect(h.question.correctRate.total).toBe(5);
    expect(h.question.correctRate.bins.find((x) => x.bin === 9)?.count).toBe(3);
    expect(h.question.attemptCount.total).toBe(2);
    expect(h.keyword.attemptCount.total).toBe(4);
  });
  it('失敗は文脈付きの Error にする', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getHistograms(SUBJECT, KEYWORD)).rejects.toThrow('ヒストグラムの取得に失敗しました: boom');
  });
  it('想定外の指標名はエラーにする', async () => {
    mock.rpc.mockResolvedValue({ data: [{ target: 'question', metric: 'x', bin: 0, item_count: 1 }], error: null });
    await expect(getHistograms(SUBJECT, null)).rejects.toThrow('ヒストグラムの取得に失敗しました');
  });
});

describe('listBinItems', () => {
  const input = {
    subjectId: SUBJECT,
    keywordId: KEYWORD,
    target: 'keyword' as const,
    metric: 'correctRate' as const,
    bin: 3,
  };
  const row = (i: number) => ({
    item_id: `id-${String(i).padStart(5, '0')}`,
    attempt_count: 0,
    correct_count: 0,
    correct_rate: null,
    question_count: 2,
    stem: null,
  });

  it('item_id 順で全ページを取得して変換する', async () => {
    const first = builder({ data: Array.from({ length: 1000 }, (_, i) => row(i)) });
    const second = builder({ data: [{ ...row(1000), attempt_count: 4, correct_count: 1, correct_rate: 0.25 }] });
    mock.rpc.mockReturnValueOnce(first.b).mockReturnValueOnce(second.b);
    const items = await listBinItems(input);
    expect(items).toHaveLength(1001);
    expect(items[0]).toEqual({
      itemId: 'id-00000',
      attemptCount: 0,
      correctCount: 0,
      correctRate: null,
      questionCount: 2,
      stem: null,
    });
    expect(items[1000]?.correctRate).toBe(0.25);
    expect(mock.rpc).toHaveBeenCalledWith('stats_bin_items', {
      p_target: 'keyword',
      p_metric: 'correct_rate',
      p_bin: 3,
      p_subject_id: SUBJECT,
      p_keyword_id: KEYWORD,
    });
    expect(first.calls).toEqual([
      ['order', ['item_id']],
      ['range', [0, 999]],
    ]);
    expect(second.calls).toContainEqual(['range', [1000, 1999]]);
  });

  it('attemptCount を attempt_count に変換する', async () => {
    mock.rpc.mockReturnValue(builder({ data: [] }).b);
    await listBinItems({ ...input, metric: 'attemptCount' });
    expect(mock.rpc.mock.calls[0]?.[1]).toMatchObject({ p_metric: 'attempt_count' });
  });

  it('途中のページが失敗したら部分結果を返さない', async () => {
    mock.rpc
      .mockReturnValueOnce(builder({ data: Array.from({ length: 1000 }, (_, i) => row(i)) }).b)
      .mockReturnValueOnce(builder({ error: { message: 'boom' } }).b);
    await expect(listBinItems(input)).rejects.toThrow('区間の一覧の取得に失敗しました: boom');
  });

  it('既知の例外を日本語にする', async () => {
    mock.rpc.mockReturnValue(builder({ error: { code: 'P0001', message: 'invalid_stats_metric' } }).b);
    await expect(listBinItems(input)).rejects.toThrow('区間の一覧の取得に失敗しました: 指標の指定が正しくありません');
  });
});

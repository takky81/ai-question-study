import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase.ts は読み込み時に環境変数を検証するため、通信しないモックに差し替える。
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: mock }));

import {
  countSubjectContents,
  createKeyword,
  createSubject,
  deleteKeyword,
  deleteSubject,
  listKeywords,
  listSubjects,
  moveKeyword,
  previewKeywordDeletion,
  renameKeyword,
  renameSubject,
  reorderKeywords,
  toCatalogErrorMessage,
} from './api';

type Result = { data?: unknown; error?: unknown; count?: number | null };

// クエリビルダーのモック。呼ばれたメソッドと引数を記録し、await で result を返す。
function builder(result: Result | ((calls: [string, unknown[]][]) => Result)) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'order', 'range', 'single']) {
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

beforeEach(() => {
  mock.from.mockReset();
  mock.rpc.mockReset();
});

describe('toCatalogErrorMessage', () => {
  it('unique 違反（23505）は重複の文言にする', () => {
    expect(toCatalogErrorMessage('科目の作成', { code: '23505', message: 'dup' })).toBe(
      '同じ名前がすでにあります',
    );
  });

  it('check 違反（23514）は空の名前の文言にする', () => {
    expect(toCatalogErrorMessage('科目の作成', { code: '23514', message: 'check' })).toBe(
      '名前を入力してください',
    );
  });

  it.each([
    ['keyword_cycle', 'キーワードを自分自身または配下へは移動できません'],
    ['duplicate_sibling', '移動先に同じ名前のキーワードがすでにあります'],
    ['keyword_subject_mismatch', '別の科目のキーワードは指定できません'],
    ['keyword_not_found', 'キーワードが見つかりません'],
    ['sibling_set_mismatch', 'キーワードの並びが最新ではありません。再読み込みしてください'],
    ['subject_not_found', '科目が見つかりません'],
    ['no_keyword', '紐づくキーワードがないため有効にできません'],
    ['one_correct_required', '正解は1つにしてください'],
    ['duplicate_choice_id', '選択肢の指定が重複しています'],
  ])('P0001 の %s は専用の文言にする', (code, expected) => {
    expect(toCatalogErrorMessage('操作', { code: 'P0001', message: code })).toBe(expected);
  });

  it('未知のコードは文脈付きの汎用文言にする', () => {
    expect(toCatalogErrorMessage('科目の取得', { code: '42501', message: 'denied' })).toBe(
      '科目の取得に失敗しました: denied',
    );
    expect(toCatalogErrorMessage('科目の取得', { message: 'Failed to fetch' })).toBe(
      '科目の取得に失敗しました: Failed to fetch',
    );
  });
});

describe('科目', () => {
  it('listSubjects は未削除の科目を名前・ID 順で取得し camelCase に変換する', async () => {
    const { b, calls } = builder({
      data: [{ id: 's1', name: '情報', created_at: '2026-01-01T00:00:00Z' }],
    });
    mock.from.mockReturnValue(b);
    await expect(listSubjects()).resolves.toEqual([
      { id: 's1', name: '情報', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(mock.from).toHaveBeenCalledWith('subjects');
    expect(calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['name', 'id']);
  });

  it('listSubjects の失敗は日本語の Error にする', async () => {
    mock.from.mockReturnValue(builder({ error: { message: 'boom' } }).b);
    await expect(listSubjects()).rejects.toThrow('科目の取得に失敗しました: boom');
  });

  it('createSubject は作成した科目を返し、重複は変換した文言で投げる', async () => {
    const ok = builder({ data: { id: 's1', name: 'A', created_at: 't' } });
    mock.from.mockReturnValue(ok.b);
    await expect(createSubject('A')).resolves.toEqual({ id: 's1', name: 'A', createdAt: 't' });
    expect(ok.calls[0]).toEqual(['insert', [{ name: 'A' }]]);

    mock.from.mockReturnValue(builder({ error: { code: '23505', message: 'dup' } }).b);
    await expect(createSubject('A')).rejects.toThrow('同じ名前がすでにあります');
  });

  it('renameSubject は名前を更新する', async () => {
    const { b, calls } = builder({});
    mock.from.mockReturnValue(b);
    await renameSubject('s1', 'B');
    expect(calls).toContainEqual(['update', [{ name: 'B' }]]);
    expect(calls).toContainEqual(['eq', ['id', 's1']]);
  });

  it('countSubjectContents はキーワードと未削除の問題の件数を返す', async () => {
    const kw = builder({ count: 3 });
    const q = builder({ count: 5 });
    mock.from.mockImplementation((t: string) => (t === 'keywords' ? kw.b : q.b));
    await expect(countSubjectContents('s1')).resolves.toEqual({
      keywordCount: 3,
      questionCount: 5,
    });
    expect(q.calls).toContainEqual(['is', ['deleted_at', null]]);
    expect(q.calls).toContainEqual(['eq', ['subject_id', 's1']]);
  });

  it('deleteSubject は delete_subject を呼び、失敗は変換する', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    await deleteSubject('s1');
    expect(mock.rpc).toHaveBeenCalledWith('delete_subject', { p_subject_id: 's1' });

    mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'subject_not_found' } });
    await expect(deleteSubject('s1')).rejects.toThrow('科目が見つかりません');
  });
});

describe('キーワード', () => {
  const row = {
    id: 'k1',
    subject_id: 's1',
    parent_id: null,
    name: 'ネットワーク',
    sort_order: 0,
  };
  const keyword = { id: 'k1', subjectId: 's1', parentId: null, name: 'ネットワーク', sortOrder: 0 };

  it('listKeywords は安定順序で全ページを取得して変換する', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ ...row, id: `a${i}` }));
    const ranges: unknown[][] = [];
    mock.from.mockImplementation(() =>
      builder((calls) => {
        const range = calls.find(([m]) => m === 'range')![1];
        ranges.push(range);
        expect(calls.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['id']);
        return { data: range[0] === 0 ? page1 : [row] };
      }).b,
    );
    const result = await listKeywords('s1');
    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual(keyword);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('listKeywords の失敗は日本語の Error にする', async () => {
    mock.from.mockReturnValue(builder({ error: { message: 'boom' } }).b);
    await expect(listKeywords('s1')).rejects.toThrow('キーワードの取得に失敗しました: boom');
  });

  it('createKeyword は sort_order を送らず作成し、変換して返す', async () => {
    const { b, calls } = builder({ data: row });
    mock.from.mockReturnValue(b);
    await expect(createKeyword('s1', null, 'ネットワーク')).resolves.toEqual(keyword);
    expect(calls[0]).toEqual([
      'insert',
      [{ subject_id: 's1', parent_id: null, name: 'ネットワーク' }],
    ]);
  });

  it('createKeyword の兄弟重複は変換した文言で投げる', async () => {
    mock.from.mockReturnValue(builder({ error: { code: '23505', message: 'dup' } }).b);
    await expect(createKeyword('s1', 'p', 'x')).rejects.toThrow('同じ名前がすでにあります');
  });

  it('renameKeyword は名前を更新する', async () => {
    const { b, calls } = builder({});
    mock.from.mockReturnValue(b);
    await renameKeyword('k1', '新');
    expect(mock.from).toHaveBeenCalledWith('keywords');
    expect(calls).toContainEqual(['update', [{ name: '新' }]]);
    expect(calls).toContainEqual(['eq', ['id', 'k1']]);
  });

  it('moveKeyword は move_keyword を呼び、循環は変換する', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    await moveKeyword('k1', null);
    expect(mock.rpc).toHaveBeenCalledWith('move_keyword', {
      p_keyword_id: 'k1',
      p_new_parent_id: null,
    });

    mock.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'keyword_cycle' } });
    await expect(moveKeyword('k1', 'k2')).rejects.toThrow(
      'キーワードを自分自身または配下へは移動できません',
    );
  });

  it('reorderKeywords は reorder_keywords を呼ぶ', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    await reorderKeywords('s1', null, ['b', 'a']);
    expect(mock.rpc).toHaveBeenCalledWith('reorder_keywords', {
      p_subject_id: 's1',
      p_parent_id: null,
      p_ordered_ids: ['b', 'a'],
    });
  });

  it('previewKeywordDeletion と deleteKeyword は影響件数を camelCase に変換する', async () => {
    const impact = { keyword_count: 3, unlinked_question_count: 2, disabled_question_count: 1 };
    const expected = { keywordCount: 3, unlinkedQuestionCount: 2, disabledQuestionCount: 1 };
    mock.rpc.mockResolvedValue({ data: impact, error: null });
    await expect(previewKeywordDeletion('k1')).resolves.toEqual(expected);
    expect(mock.rpc).toHaveBeenLastCalledWith('preview_keyword_deletion', { p_keyword_id: 'k1' });
    // 複合型が配列で返る場合も1行目を使う
    mock.rpc.mockResolvedValue({ data: [impact], error: null });
    await expect(deleteKeyword('k1')).resolves.toEqual(expected);
    expect(mock.rpc).toHaveBeenLastCalledWith('delete_keyword', { p_keyword_id: 'k1' });
  });

  it('deleteKeyword の失敗は文脈付きで投げる', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(deleteKeyword('k1')).rejects.toThrow('キーワードの削除に失敗しました: boom');
  });
});

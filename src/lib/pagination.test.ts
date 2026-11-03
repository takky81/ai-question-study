import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, PAGE_SIZE, type PageResult } from './pagination';

// total 件の行（id 0..total-1）を範囲で切り出して返す偽のページ取得関数
function makeSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const fetchPage = vi.fn(
    async (from: number, to: number): Promise<PageResult<{ id: number }>> => ({
      data: rows.slice(from, to + 1),
      error: null,
    }),
  );
  return { rows, fetchPage };
}

describe('fetchAllPages', () => {
  it('PAGE_SIZE は 1,000 件', () => {
    expect(PAGE_SIZE).toBe(1000);
  });

  it('0 件なら空配列を返す', async () => {
    const { fetchPage } = makeSource(0);
    await expect(fetchAllPages(fetchPage, '問題一覧の取得')).resolves.toEqual([]);
    expect(fetchPage.mock.calls).toEqual([[0, 999]]);
  });

  it('999 件なら1回で全件を返す', async () => {
    const { rows, fetchPage } = makeSource(999);
    await expect(fetchAllPages(fetchPage, '問題一覧の取得')).resolves.toEqual(rows);
    expect(fetchPage.mock.calls).toEqual([[0, 999]]);
  });

  it('ちょうど 1,000 件なら2ページ目（0 件）まで取得して全件を返す', async () => {
    const { rows, fetchPage } = makeSource(1000);
    const result = await fetchAllPages(fetchPage, '問題一覧の取得');
    expect(result).toEqual(rows);
    expect(fetchPage.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('2,500 件を欠落・重複なく順序どおりに返す', async () => {
    const { rows, fetchPage } = makeSource(2500);
    const result = await fetchAllPages(fetchPage, '問題一覧の取得');
    expect(result).toEqual(rows);
    expect(new Set(result.map((r) => r.id)).size).toBe(2500);
    expect(fetchPage.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('2ページ目が error を返したら文脈付きの日本語エラーを投げ、以降を取得しない', async () => {
    const fetchPage = vi.fn(async (from: number): Promise<PageResult<number>> =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
        : { data: null, error: { message: 'timeout' } },
    );
    await expect(fetchAllPages(fetchPage, '問題一覧の取得')).rejects.toThrow(
      new Error('問題一覧の取得に失敗しました: timeout'),
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('2ページ目が reject したら文脈付きの日本語エラーを投げる', async () => {
    const fetchPage = vi.fn(async (from: number): Promise<PageResult<number>> => {
      if (from === 0) return { data: Array.from({ length: 1000 }, (_, i) => i), error: null };
      throw new Error('network down');
    });
    await expect(fetchAllPages(fetchPage, '問題一覧の取得')).rejects.toThrow(
      new Error('問題一覧の取得に失敗しました: network down'),
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

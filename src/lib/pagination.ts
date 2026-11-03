// PostgREST の1回あたりの取得上限に合わせたページサイズ
export const PAGE_SIZE = 1000;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * 1,000 件ずつ範囲を進めて全件を取得し、順序どおりに連結して返す。
 * 安定した一意の順序の指定は呼び出し側（fetchPage）の責任とする。
 * 途中のページが error を返すか reject した場合は部分結果を返さず、
 * 「{context}に失敗しました: {message}」の Error を投げる。
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  context: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let result: PageResult<T>;
    try {
      result = await fetchPage(from, from + PAGE_SIZE - 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`${context}に失敗しました: ${message}`);
    }
    if (result.error) {
      throw new Error(`${context}に失敗しました: ${result.error.message}`);
    }
    const rows = result.data ?? [];
    all.push(...rows);
    // 上限未満なら最終ページ
    if (rows.length < PAGE_SIZE) return all;
  }
}

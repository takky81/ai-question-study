// 出題範囲（科目とキーワード）と URL 検索パラメータの相互変換（1.7、10.6）。
// 解答画面の URL は quiz/play?subject=<id>&keyword=<id>。
export type QuizRange = { subjectId: string; keywordId: string | null };

const PARAM = { subjectId: 'subject', keywordId: 'keyword' } as const;
// UUID でない値は DB へ渡さない（22P02 を避ける）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 科目全体（keywordId が null）は keyword を含めない
export function toRangeParams(range: QuizRange): URLSearchParams {
  const params = new URLSearchParams();
  params.set(PARAM.subjectId, range.subjectId);
  if (range.keywordId !== null) params.set(PARAM.keywordId, range.keywordId);
  return params;
}

// 科目がない、または科目・キーワードが UUID 形式でなければ範囲なし（null）
export function parseRangeParams(params: URLSearchParams): QuizRange | null {
  const subjectId = params.get(PARAM.subjectId);
  if (subjectId === null || !UUID.test(subjectId)) return null;
  const keywordId = params.get(PARAM.keywordId);
  if (keywordId === null) return { subjectId, keywordId: null };
  return UUID.test(keywordId) ? { subjectId, keywordId } : null;
}

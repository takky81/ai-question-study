// 問題一覧の絞り込み条件と URL 検索パラメータの相互変換（7.3）。
// 条件を URL に保持し、編集画面から戻ったとき同じ一覧に戻れるようにする。
import type { QuestionKind, QuestionStatus } from './types';

export type QuestionFilter = {
  keywordId: string | null;
  kind: QuestionKind | null;
  status: QuestionStatus | null;
  text: string;
  page: number; // 1 始まり
};

export const DEFAULT_FILTER: QuestionFilter = { keywordId: null, kind: null, status: null, text: '', page: 1 };

// search_questions RPC の引数（未指定は null）
export type SearchQuestionsArgs = {
  p_subject_id: string;
  p_keyword_id: string | null;
  p_kind: QuestionKind | null;
  p_status: QuestionStatus | null;
  p_text: string | null;
};

const PARAM = { keywordId: 'keyword', kind: 'kind', status: 'status', text: 'q', page: 'page' } as const;
const KINDS: readonly QuestionKind[] = ['keyword', 'feature'];
const STATUSES: readonly QuestionStatus[] = ['active', 'disabled'];

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((v) => v === value) ?? null;
}

// 不正値は既定値にする
export function parseFilter(params: URLSearchParams): QuestionFilter {
  const keywordId = params.get(PARAM.keywordId);
  const page = params.get(PARAM.page) ?? '';
  return {
    keywordId: keywordId ? keywordId : null,
    kind: pick(params.get(PARAM.kind), KINDS),
    status: pick(params.get(PARAM.status), STATUSES),
    text: params.get(PARAM.text) ?? '',
    page: /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
  };
}

// 既定値の項目は URL に含めない
export function toSearchParams(filter: QuestionFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.keywordId) params.set(PARAM.keywordId, filter.keywordId);
  if (filter.kind) params.set(PARAM.kind, filter.kind);
  if (filter.status) params.set(PARAM.status, filter.status);
  if (filter.text !== '') params.set(PARAM.text, filter.text);
  if (Number.isInteger(filter.page) && filter.page > 1) params.set(PARAM.page, String(filter.page));
  return params;
}

// 絞り込み条件を search_questions の引数へ変換する（ページは range で別に指定する）
export function toSearchArgs(subjectId: string, filter: QuestionFilter): SearchQuestionsArgs {
  return {
    p_subject_id: subjectId,
    p_keyword_id: filter.keywordId,
    p_kind: filter.kind,
    p_status: filter.status,
    p_text: filter.text === '' ? null : filter.text,
  };
}

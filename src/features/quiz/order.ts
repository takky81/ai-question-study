// 出題順の純粋関数。未出題 → 定着率の低い順で、同値は最後の解答日時とセッションごとの乱数（tieBreak）で決める。
import type { QuizCandidate } from './types';

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// DB の timestamptz は小数秒の桁数やオフセットが揃わないため、文字列ではなく時刻（ミリ秒）で比べる
function compareTime(a: string, b: string): number {
  return Math.sign(Date.parse(a) - Date.parse(b));
}

// 最後の解答日時が null の候補は、同値の中で先にする（出題済みでは通常起こらないが順序を決定的にする）
function compareNullableTime(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return compareTime(a, b);
}

function isUnseen(c: QuizCandidate): boolean {
  return c.attemptCount === 0;
}

// 問題 ID → セッションごとの乱数。同率の順序をこの昇順で決める（要件 2.3）
export type TieBreak = ReadonlyMap<string, number>;

const NO_TIE_BREAK: TieBreak = new Map();

// 乱数の昇順。等しいとき（実質起こらない）だけ ID で決め、全順序に保つ
function compareTie(a: QuizCandidate, b: QuizCandidate, tieBreak: TieBreak): number {
  const diff = (tieBreak.get(a.questionId) ?? 0) - (tieBreak.get(b.questionId) ?? 0);
  return Math.sign(diff) || compareText(a.questionId, b.questionId);
}

export function compareCandidates(a: QuizCandidate, b: QuizCandidate, tieBreak: TieBreak = NO_TIE_BREAK): number {
  const aUnseen = isUnseen(a);
  const bUnseen = isUnseen(b);
  if (aUnseen !== bUnseen) return aUnseen ? -1 : 1;
  if (aUnseen) {
    return compareTime(a.createdAt, b.createdAt) || compareTie(a, b, tieBreak);
  }
  // 「？」エリアの解答のみで定着率がない問題は定着率 0 とみなす
  const retentionDiff = (a.retention ?? 0) - (b.retention ?? 0);
  if (retentionDiff !== 0) return retentionDiff < 0 ? -1 : 1;
  return compareNullableTime(a.lastAnsweredAt, b.lastAnsweredAt) || compareTie(a, b, tieBreak);
}

export function pickNextCandidate(
  candidates: readonly QuizCandidate[],
  answeredIds: ReadonlySet<string>,
  tieBreak: TieBreak = NO_TIE_BREAK,
): QuizCandidate | null {
  let best: QuizCandidate | null = null;
  for (const c of candidates) {
    if (answeredIds.has(c.questionId)) continue;
    if (best === null || compareCandidates(c, best, tieBreak) < 0) best = c;
  }
  return best;
}

export function countCandidates(candidates: readonly QuizCandidate[]): { total: number; unseen: number } {
  return { total: candidates.length, unseen: candidates.filter(isUnseen).length };
}

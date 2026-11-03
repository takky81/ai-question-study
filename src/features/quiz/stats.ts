// 成績の表示値を作る純粋関数（2.7、6.2〜6.4）。
// 数え方は question_stats ビューと同じ: 種類（normal、guess、unknown）を問わず全解答を出題数に数える。
import type { QuestionStats } from './types';

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// 判定後に今回の解答を即時に反映する（記録の成功後は RPC の値で置き換える）
export function applyAnswerToStats(stats: QuestionStats, isCorrect: boolean): QuestionStats {
  const attemptCount = stats.attemptCount + 1;
  const correctCount = stats.correctCount + (isCorrect ? 1 : 0);
  return { ...stats, attemptCount, correctCount, correctRate: correctCount / attemptCount };
}

// 出題数 0 は「未出題」、それ以外は百分率
export function formatCorrectRate(stats: Pick<QuestionStats, 'attemptCount' | 'correctRate'>): string {
  if (stats.attemptCount === 0 || stats.correctRate === null) return '未出題';
  return percent(stats.correctRate);
}

// 出題数 0 は「未出題」、SRS 状態なしは「未評価」、それ以外は百分率
export function formatRetention(retention: number | null, attemptCount: number): string {
  if (attemptCount === 0) return '未出題';
  if (retention === null) return '未評価';
  return percent(retention);
}

// 出題中の問題の成績: 「正答 3 / 出題 5（60%）」、出題数 0 は「未出題」（6.1〜6.3）。
// 判定後は呼び出し元が更新した stats（session.stats）を渡す。
import { formatCorrectRate } from './stats';
import type { QuestionStats } from './types';

export function QuestionStatsBar({ stats }: { stats: QuestionStats }) {
  return (
    <p className="text-sm text-text-muted" aria-live="polite">
      {`正答 ${stats.correctCount} / 出題 ${stats.attemptCount}（${formatCorrectRate(stats)}）`}
    </p>
  );
}

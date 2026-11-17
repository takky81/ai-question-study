// 出題中の問題の成績: 「正答 3 / 出題 5（60%）」、出題数 0 は「未出題」（6.1〜6.3）。
// 判定後は呼び出し元が更新した stats（session.stats）を渡す。
// 判定後は正誤に合わせて枠と色を変え、正誤の文字を添える（12.1、12.2、12.5、12.7）。
// 枠と正誤の文字の領域は常に確保し、判定の前後で大きさと位置を変えない（12.4、12.8）。
// 右手用・左手用の配置にかかわらず同じ表示にする（12.9）。
import { formatCorrectRate } from './stats';
import type { QuestionStats } from './types';

export type AnswerOutcome = 'correct' | 'incorrect';

const OUTCOME_CLASS: Record<AnswerOutcome, string> = {
  correct: 'mark-correct border-correct',
  incorrect: 'mark-incorrect border-incorrect',
};

const OUTCOME_LABEL: Record<AnswerOutcome, string> = {
  correct: '○ 正解',
  incorrect: '× 不正解',
};

export function QuestionStatsBar({ stats, outcome = null }: { stats: QuestionStats; outcome?: AnswerOutcome | null }) {
  const tone = outcome === null ? 'border-transparent text-text-muted' : OUTCOME_CLASS[outcome];
  return (
    <p className={`rounded border-2 px-2 py-1 text-sm ${tone}`} aria-live="polite">
      <span className="inline-block w-[5em] font-bold">{outcome === null ? '' : OUTCOME_LABEL[outcome]}</span>
      {`正答 ${stats.correctCount} / 出題 ${stats.attemptCount}（${formatCorrectRate(stats)}）`}
    </p>
  );
}

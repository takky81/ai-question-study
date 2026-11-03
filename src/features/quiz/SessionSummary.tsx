// 終了表示: 解答数・正答数と、同じ範囲の範囲選択へ戻る導線（2.5、10.6）。
import { Link } from 'react-router';

import { toRangeParams, type QuizRange } from './range';

type Props = { answeredCount: number; correctCount: number; range: QuizRange };

export function SessionSummary({ answeredCount, correctCount, range }: Props) {
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="出題の終了">
      <p className="text-lg font-bold text-text">{`${answeredCount} 問解答、正答 ${correctCount} 問`}</p>
      <Link
        to={`/quiz?${toRangeParams(range).toString()}`}
        className="tap-target focus-ring flex items-center rounded text-primary underline"
      >
        範囲選択へ戻る
      </Link>
    </section>
  );
}

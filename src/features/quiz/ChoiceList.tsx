// 選択肢一覧: 各選択肢の選択領域と右端の「？」エリア、末尾の固定の「わからない」（4.1、4.3、4.6、4.7）。
// 判定後は選択（太枠）と正誤（色）を1つの選択肢内で同時に示し、「？」の位置の MarkCell に ○／× を出し、
// 解説を枠内に出して操作を不可にする（5.1〜5.5、5.7〜5.9）。
import { Circle, HelpCircle, X } from 'lucide-react';

import type { AnswerKind, QuizChoice } from './types';

export type ChoiceDisplayState = { selected: boolean; mark: 'correct' | 'incorrect' | null };

export function choiceDisplayState(
  choiceId: string | null, // null は「わからない」
  selection: { choiceId: string | null } | null,
  correctChoiceId: string | null, // 判定前は null
): ChoiceDisplayState {
  if (selection === null || correctChoiceId === null) return { selected: false, mark: null };
  const selected = selection.choiceId === choiceId;
  if (choiceId !== null && choiceId === correctChoiceId) return { selected, mark: 'correct' };
  return { selected, mark: selected ? 'incorrect' : null };
}

type Props = {
  choices: QuizChoice[];
  selection: { choiceId: string | null } | null;
  correctChoiceId: string | null; // 判定前は null
  disabled?: boolean; // 判定前でも操作を止める場合（記録中など）
  onAnswer: (kind: AnswerKind, choiceId: string | null) => void;
};

const BUTTON = 'tap-target focus-ring text-text disabled:cursor-default';

// 右端の列: 判定前の「？」と判定後の MarkCell で同じ幅（44px）と左の境界線を共有する（4.6、5.9）
const COLUMN = 'flex w-11 shrink-0 items-center justify-center border-l border-border';

function MarkCell({ mark }: { mark: ChoiceDisplayState['mark'] }) {
  const color = mark === 'correct' ? 'text-correct' : mark === 'incorrect' ? 'text-incorrect' : '';
  return (
    <span data-testid="mark-cell" className={`${COLUMN} font-bold ${color}`}>
      {mark === 'correct' && (
        <>
          <Circle aria-hidden="true" className="h-5 w-5" />
          <span className="sr-only">正解</span>
        </>
      )}
      {mark === 'incorrect' && (
        <>
          <X aria-hidden="true" className="h-5 w-5" />
          <span className="sr-only">不正解</span>
        </>
      )}
    </span>
  );
}

function SelectedNote({ state }: { state: ChoiceDisplayState }) {
  return state.selected ? <span className="sr-only">選択した解答</span> : null;
}

function itemClass(state: ChoiceDisplayState): string {
  const mark = state.mark === 'correct' ? 'mark-correct' : state.mark === 'incorrect' ? 'mark-incorrect' : 'bg-surface';
  return `flex min-w-0 flex-col rounded border border-border ${state.selected ? 'choice-selected' : ''} ${mark}`;
}

export function ChoiceList({ choices, selection, correctChoiceId, disabled = false, onAnswer }: Props) {
  const judged = selection !== null && correctChoiceId !== null;
  const locked = judged || disabled;
  const unknownState = choiceDisplayState(null, selection, correctChoiceId);

  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {choices.map((c) => {
        const state = choiceDisplayState(c.id, selection, correctChoiceId);
        return (
          <li key={c.id} className={itemClass(state)}>
            <div className="flex min-w-0 items-stretch gap-2">
              <button
                type="button"
                className={`${BUTTON} min-w-0 flex-1 break-words p-3 text-left`}
                disabled={locked}
                onClick={() => onAnswer('normal', c.id)}
              >
                {c.body}
              </button>
              <SelectedNote state={state} />
              {judged ? (
                <MarkCell mark={state.mark} />
              ) : (
                <button
                  type="button"
                  className={`${BUTTON} ${COLUMN}`}
                  disabled={locked}
                  aria-label={`推測で解答: ${c.body}`}
                  onClick={() => onAnswer('guess', c.id)}
                >
                  <HelpCircle aria-hidden="true" className="h-5 w-5" />
                </button>
              )}
            </div>
            {judged && c.explanation.trim() !== '' && (
              <p className="min-w-0 break-words border-t border-border p-3 text-sm text-text">{c.explanation}</p>
            )}
          </li>
        );
      })}
      <li className={itemClass(unknownState)}>
        <div className="flex min-w-0 items-stretch gap-2">
          <button
            type="button"
            className={`${BUTTON} min-w-0 flex-1 p-3 text-left`}
            disabled={locked}
            onClick={() => onAnswer('unknown', null)}
          >
            わからない
          </button>
          <SelectedNote state={unknownState} />
          {judged && unknownState.selected && <MarkCell mark={unknownState.mark} />}
        </div>
      </li>
    </ul>
  );
}

// 選択肢の編集: 本文・解説・正解（1つだけ）・上へ／下へ／削除・追加（4.5、9.5）。
// 「わからない」は回答時に固定で付くもので、ここでは編集対象にしない（4.9）。
import { useId } from 'react';

import { addChoice, moveChoice, removeChoice, setCorrect } from './draft';
import type { ChoiceInput, QuestionInput } from './types';
import type { ValidationTarget } from './validate';

type Props = {
  draft: QuestionInput;
  onChange: (next: QuestionInput) => void;
  // 欄の近くに表示するメッセージの要素 ID（QuestionEditPage が渡す）
  describedBy?: (target: ValidationTarget) => string | undefined;
};

const BUTTON = 'tap-target focus-ring rounded border border-border px-3 text-text disabled:opacity-50';
const FIELD = 'focus-ring min-w-0 rounded border border-border bg-bg p-2 text-text';

export function ChoiceEditor({ draft, onChange, describedBy }: Props) {
  const group = useId();
  const count = draft.choices.length;

  function update(index: number, patch: Partial<ChoiceInput>) {
    onChange({ ...draft, choices: draft.choices.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={describedBy?.({ field: 'choices' })}>
      <legend className="font-bold">選択肢</legend>
      <ol className="flex min-w-0 flex-col gap-3">
        {draft.choices.map((c, i) => {
          const n = i + 1;
          return (
            <li
              key={i}
              className={`flex min-w-0 flex-col gap-2 rounded border border-border p-3 ${c.isCorrect ? 'mark-correct' : 'bg-surface'}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="tap-target flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${group}-correct`}
                    className="focus-ring h-5 w-5"
                    checked={c.isCorrect}
                    onChange={() => onChange(setCorrect(draft, i))}
                    aria-label={`選択肢 ${n} を正解にする`}
                  />
                  <span className="font-bold">選択肢 {n}</span>
                </label>
                {c.isCorrect && (
                  <span className="font-bold">
                    <span aria-hidden="true">○</span>
                    <span className="sr-only">正解</span>
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className={BUTTON}
                    disabled={i === 0}
                    onClick={() => onChange(moveChoice(draft, i, i - 1))}
                    aria-label={`選択肢 ${n} を上へ`}
                  >
                    上へ
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    disabled={i === count - 1}
                    onClick={() => onChange(moveChoice(draft, i, i + 1))}
                    aria-label={`選択肢 ${n} を下へ`}
                  >
                    下へ
                  </button>
                  <button
                    type="button"
                    className={BUTTON}
                    onClick={() => onChange(removeChoice(draft, i))}
                    aria-label={`選択肢 ${n} を削除`}
                  >
                    削除
                  </button>
                </div>
              </div>
              <textarea
                className={FIELD}
                rows={2}
                value={c.body}
                onChange={(e) => update(i, { body: e.target.value })}
                aria-label={`選択肢 ${n} の本文`}
                aria-describedby={describedBy?.({ field: 'choiceBody', index: i })}
                placeholder="本文"
              />
              <textarea
                className={FIELD}
                rows={2}
                value={c.explanation}
                onChange={(e) => update(i, { explanation: e.target.value })}
                aria-label={`選択肢 ${n} の解説`}
                aria-describedby={describedBy?.({ field: 'choiceExplanation', index: i })}
                placeholder="解説"
              />
            </li>
          );
        })}
      </ol>
      <button type="button" className={`${BUTTON} self-start`} onClick={() => onChange(addChoice(draft))}>
        選択肢を追加
      </button>
    </fieldset>
  );
}

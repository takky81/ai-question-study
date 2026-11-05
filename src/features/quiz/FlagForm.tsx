// 問題フラグのチェックボックスと自由入力、自動保存の状態表示（7.1〜7.7、7.9、7.10、10.3）。
// 初期値は listOpenFlags の結果（「？」エリアで付いた guessable を含む）でマウント時だけ読む。
// 保存要求の集約・直列化と変更有無の判定は呼び出し側の flagAutosave（FlagSaver）に委ねる。
import { useId, useState } from 'react';

import type { FlagSaveStatus } from './flagAutosave';
import { CHECKBOX_FLAG_IDS, QUESTION_FLAGS, type CheckboxFlagId } from './flags';

type Props = {
  initialFlags: readonly CheckboxFlagId[];
  initialComment: string | null;
  status: FlagSaveStatus;
  /** チェックの変更ごとに変更後の集合で呼ぶ。 */
  onChangeFlags: (flags: CheckboxFlagId[]) => void;
  /** textarea の blur で入力値をそのまま渡す。 */
  onCommitComment: (text: string) => void;
  onRetry: () => void;
};

export function FlagForm({ initialFlags, initialComment, status, onChangeFlags, onCommitComment, onRetry }: Props) {
  const idPrefix = useId();
  const [checked, setChecked] = useState<ReadonlySet<CheckboxFlagId>>(() => new Set(initialFlags));
  const [comment, setComment] = useState(initialComment ?? '');

  const toggle = (id: CheckboxFlagId) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
    onChangeFlags(CHECKBOX_FLAG_IDS.filter((f) => next.has(f)));
  };

  const commentId = `${idPrefix}-comment`;

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded border border-border bg-surface p-3"
      aria-label="問題フラグ"
    >
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-1 font-bold text-text">問題フラグ</legend>
        {QUESTION_FLAGS.map((f) => {
          if (f.input !== 'checkbox') return null;
          const id = f.id as CheckboxFlagId;
          const inputId = `${idPrefix}-${id}`;
          return (
            <label
              key={id}
              htmlFor={inputId}
              className="tap-target flex min-w-0 cursor-pointer items-center gap-3 rounded text-text"
            >
              <input
                id={inputId}
                type="checkbox"
                className="focus-ring h-5 w-5 shrink-0"
                checked={checked.has(id)}
                onChange={() => toggle(id)}
              />
              <span className="min-w-0 break-words">{f.label}</span>
            </label>
          );
        })}
      </fieldset>
      {QUESTION_FLAGS.filter((f) => f.input === 'text').map((f) => (
        <div key={f.id} className="flex min-w-0 flex-col gap-1">
          <label htmlFor={commentId} className="text-text">
            {f.label}
          </label>
          <textarea
            id={commentId}
            className="tap-target focus-ring w-full min-w-0 rounded border border-border bg-bg p-2 text-text"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={(e) => onCommitComment(e.target.value)}
          />
        </div>
      ))}
      <p role="status" aria-live="polite" className="min-h-[1.5em] text-text-muted">
        {status.kind === 'saving' ? '保存中…' : status.kind === 'saved' ? '保存しました' : ''}
      </p>
      {status.kind === 'failed' ? (
        <div role="alert" className="flex min-w-0 flex-col gap-2 text-warn">
          <p className="min-w-0 break-words">{status.message}</p>
          <button
            type="button"
            className="tap-target focus-ring self-start rounded border border-border px-3 py-2 text-text"
            onClick={onRetry}
          >
            再試行
          </button>
        </div>
      ) : null}
    </section>
  );
}

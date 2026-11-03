// 問題フラグのチェックボックスと自由入力、保存（7.1、7.3、7.6、7.7、10.3）。
// 初期値は listOpenFlags の結果（「？」エリアで付いた guessable を含む）。保存は呼び出し側の saveQuestionFlags に委ねる。
import { useId, useState, type FormEvent } from 'react';

import { CHECKBOX_FLAG_IDS, QUESTION_FLAGS, type CheckboxFlagId } from './flags';

type Props = {
  initialFlags: readonly CheckboxFlagId[];
  initialComment: string | null;
  onSave: (flags: CheckboxFlagId[], comment: string) => Promise<void>;
};

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string };

export function FlagForm({ initialFlags, initialComment, onSave }: Props) {
  const idPrefix = useId();
  const [checked, setChecked] = useState<ReadonlySet<CheckboxFlagId>>(() => new Set(initialFlags));
  const [comment, setComment] = useState(initialComment ?? '');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const saving = state.kind === 'saving';

  const toggle = (id: CheckboxFlagId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (saving) return;
    setState({ kind: 'saving' });
    try {
      await onSave(
        CHECKBOX_FLAG_IDS.filter((id) => checked.has(id)),
        comment,
      );
      setState({ kind: 'saved' });
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : 'フラグの保存に失敗しました' });
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  const commentId = `${idPrefix}-comment`;

  return (
    <form className="flex min-w-0 flex-col gap-3 rounded border border-border bg-surface p-3" aria-label="問題フラグ" onSubmit={onSubmit}>
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-1 font-bold text-text">問題フラグ</legend>
        {QUESTION_FLAGS.map((f) => {
          if (f.input !== 'checkbox') return null;
          const id = f.id as CheckboxFlagId;
          const inputId = `${idPrefix}-${id}`;
          return (
            <label key={id} htmlFor={inputId} className="tap-target flex min-w-0 cursor-pointer items-center gap-3 rounded text-text">
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
          />
        </div>
      ))}
      {state.kind === 'failed' ? (
        <div role="alert" className="flex min-w-0 flex-col gap-2 text-warn">
          <p className="min-w-0 break-words">{state.message}</p>
          <button
            type="button"
            className="tap-target focus-ring self-start rounded border border-border px-3 py-2 text-text"
            onClick={() => void save()}
          >
            再試行
          </button>
        </div>
      ) : null}
      {state.kind === 'saved' ? (
        <p role="status" className="text-text-muted">
          保存しました
        </p>
      ) : null}
      <button
        type="submit"
        className="tap-target focus-ring self-start rounded bg-primary px-4 py-2 font-bold text-surface disabled:opacity-60"
        disabled={saving}
      >
        {saving ? '保存中…' : 'フラグを保存'}
      </button>
    </form>
  );
}

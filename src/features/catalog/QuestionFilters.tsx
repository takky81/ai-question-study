import { useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import type { QuestionFilter } from './filters';
import type { QuestionKind, QuestionStatus } from './types';

type Props = {
  filter: QuestionFilter;
  /** 選択中のキーワードの階層パス（キーワード未指定なら null） */
  keywordLabel: string | null;
  /** 条件を変えたときに呼ぶ。ページは呼び出し側で1に戻す */
  onChange: (next: QuestionFilter) => void;
};

const FIELD = 'tap-target focus-ring min-w-0 rounded border border-border bg-bg px-2';

/**
 * 問題一覧の絞り込み（7.2、7.3）。条件は親が URL に保持する。
 * キーワードは木で選ぶため、ここでは表示と解除だけを行う。語は「検索」で確定する。
 */
export function QuestionFilters({ filter, keywordLabel, onChange }: Props): ReactElement {
  const id = useId();
  const [text, setText] = useState(filter.text);

  // URL 側の変更（戻る操作など）を入力欄へ反映する
  useEffect(() => setText(filter.text), [filter.text]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onChange({ ...filter, text: text.trim() });
  }

  return (
    <form
      role="search"
      aria-label="問題の絞り込み"
      onSubmit={onSubmit}
      className="flex min-w-0 flex-wrap items-end gap-2"
    >
      {filter.keywordId && (
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2">
          <span className="text-text-muted">キーワード:</span>
          <span className="min-w-0 break-words">{keywordLabel ?? '（不明なキーワード）'}</span>
          <button
            type="button"
            aria-label="キーワードの指定を解除"
            onClick={() => onChange({ ...filter, keywordId: null })}
            className="tap-target focus-ring rounded border border-border px-3"
          >
            解除
          </button>
        </div>
      )}
      <label htmlFor={`${id}-kind`} className="flex min-w-0 flex-col gap-1">
        <span>種別</span>
        <select
          id={`${id}-kind`}
          value={filter.kind ?? ''}
          onChange={(e) => onChange({ ...filter, kind: (e.target.value || null) as QuestionKind | null })}
          className={FIELD}
        >
          <option value="">すべて</option>
          <option value="keyword">キーワード問題</option>
          <option value="feature">特徴問題</option>
        </select>
      </label>
      <label htmlFor={`${id}-status`} className="flex min-w-0 flex-col gap-1">
        <span>状態</span>
        <select
          id={`${id}-status`}
          value={filter.status ?? ''}
          onChange={(e) =>
            onChange({ ...filter, status: (e.target.value || null) as QuestionStatus | null })
          }
          className={FIELD}
        >
          <option value="">すべて</option>
          <option value="active">有効</option>
          <option value="disabled">無効</option>
        </select>
      </label>
      <label htmlFor={`${id}-text`} className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <span>語</span>
        <input
          id={`${id}-text`}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={FIELD}
        />
      </label>
      <button
        type="submit"
        className="tap-target focus-ring rounded border border-primary bg-primary px-4 font-bold text-bg"
      >
        検索
      </button>
    </form>
  );
}

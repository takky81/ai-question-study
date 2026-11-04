// 科目とキーワード範囲の select（1.2、1.3、7.2）。範囲の先頭「科目全体」は null を表す。
import { useId, useMemo, type ReactElement } from 'react';

import type { Subject } from '@/features/catalog/types';
import type { KeywordNode } from '@/lib/keywordTree';

import { toKeywordOptions } from './keywordOptions';

type Props = {
  subjects: readonly Subject[];
  subjectId: string | null;
  keywords: readonly KeywordNode[];
  keywordId: string | null;
  onSubjectChange: (subjectId: string) => void;
  onKeywordChange: (keywordId: string | null) => void;
};

const WHOLE = '';
const selectClass = 'tap-target focus-ring w-full rounded border bg-surface px-2';

export function RangeSelector({
  subjects,
  subjectId,
  keywords,
  keywordId,
  onSubjectChange,
  onKeywordChange,
}: Props): ReactElement {
  const id = useId();
  const options = useMemo(() => toKeywordOptions(keywords), [keywords]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-subject`}>科目</label>
        <select
          id={`${id}-subject`}
          value={subjectId ?? ''}
          onChange={(e) => onSubjectChange(e.target.value)}
          className={selectClass}
        >
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-keyword`}>範囲</label>
        <select
          id={`${id}-keyword`}
          value={keywordId ?? WHOLE}
          onChange={(e) => onKeywordChange(e.target.value === WHOLE ? null : e.target.value)}
          className={selectClass}
        >
          <option value={WHOLE}>科目全体</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

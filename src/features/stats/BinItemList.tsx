// 掘り下げの一覧: 区間の設問・キーワード（5.2、5.3、5.6、5.9、7.1、7.2）。items は sortBinItems 済みを受け取る。
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { keywordPath, type KeywordNode } from '@/lib/keywordTree';

import { formatRate, stemExcerpt } from './items';
import type { BinItem, StatsTarget } from './types';

type Props = {
  target: StatsTarget;
  title: string;
  items: readonly BinItem[];
  subjectId: string;
  keywords: readonly KeywordNode[];
  onClose: () => void;
};

const score = (item: BinItem) => `正答 ${item.correctCount} / 出題 ${item.attemptCount}（${formatRate(item)}）`;

export function BinItemList({ target, title, items, subjectId, keywords, onClose }: Props): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="min-w-0 text-base font-bold break-words">
          {title}（{items.length}件）
        </h2>
        <button type="button" onClick={onClose} className="tap-target focus-ring shrink-0 rounded border px-3">
          閉じる
        </button>
      </div>
      <ul className="flex min-w-0 flex-col gap-1">
        {items.map((item) =>
          target === 'question' ? (
            <li key={item.itemId} className="min-w-0">
              <Link
                to={`/catalog/${subjectId}/questions/${item.itemId}`}
                className="tap-target focus-ring flex min-w-0 flex-col justify-center rounded border px-3 py-2 break-words"
              >
                <span>{stemExcerpt(item.stem ?? '')}</span>
                <span className="text-sm text-text-muted">{score(item)}</span>
              </Link>
            </li>
          ) : (
            <li key={item.itemId} className="flex min-w-0 flex-col rounded border px-3 py-2 break-words">
              <span>
                {keywordPath(keywords, item.itemId)
                  .map((k) => k.name)
                  .join(' / ')}
              </span>
              <span className="text-sm text-text-muted">
                問題 {item.questionCount ?? 0} 問・{score(item)}
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

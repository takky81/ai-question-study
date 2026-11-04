// 掘り下げの一覧の並びと表示値（5.2、5.4、5.9）。
import type { BinItem } from './types';

const STEM_EXCERPT_LENGTH = 80;

// 正答率の昇順（未出題の null を先頭）、同値は出題数の降順、さらに ID の昇順。
export function sortBinItems(items: readonly BinItem[]): BinItem[] {
  return [...items].sort((a, b) => {
    if (a.correctRate !== b.correctRate) {
      if (a.correctRate === null) return -1;
      if (b.correctRate === null) return 1;
      return a.correctRate - b.correctRate;
    }
    if (a.attemptCount !== b.attemptCount) {
      return b.attemptCount - a.attemptCount;
    }
    if (a.itemId < b.itemId) return -1;
    if (a.itemId > b.itemId) return 1;
    return 0;
  });
}

export function formatRate(item: Pick<BinItem, 'attemptCount' | 'correctRate'>): string {
  if (item.attemptCount === 0 || item.correctRate === null) return '未出題';
  return `${Math.round(item.correctRate * 100)}%`;
}

// コードポイント単位で先頭 80 文字を切り出し、超過分は「…」にする。
export function stemExcerpt(stem: string): string {
  const chars = Array.from(stem);
  if (chars.length <= STEM_EXCERPT_LENGTH) return stem;
  return `${chars.slice(0, STEM_EXCERPT_LENGTH).join('')}…`;
}

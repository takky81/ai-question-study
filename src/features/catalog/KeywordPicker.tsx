// 紐づけるキーワードの選択: 科目の木をチェックボックスで表示し、葉・途中を区別なく複数選べる（4.3）。
// 選択済みは階層パスで一覧表示する（8.5）。
import { useMemo } from 'react';

import { buildKeywordTree, keywordPath, type KeywordTreeNode } from '../../lib/keywordTree';
import type { Keyword } from './types';

type Props = {
  keywords: readonly Keyword[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  describedBy?: string;
};

// 深い木でも再帰の上限に当たらないよう、表示順の平坦な行に展開する
function flatten(roots: KeywordTreeNode[]): { node: KeywordTreeNode; depth: number }[] {
  const rows: { node: KeywordTreeNode; depth: number }[] = [];
  const stack = [...roots].reverse().map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const row = stack.pop()!;
    rows.push(row);
    for (let i = row.node.children.length - 1; i >= 0; i--) {
      stack.push({ node: row.node.children[i]!, depth: row.depth + 1 });
    }
  }
  return rows;
}

export function KeywordPicker({ keywords, selectedIds, onChange, describedBy }: Props) {
  const rows = useMemo(() => flatten(buildKeywordTree(keywords)), [keywords]);
  const selected = new Set(selectedIds);

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" aria-describedby={describedBy}>
      <legend className="font-bold">キーワード</legend>
      {rows.length === 0 ? (
        <p className="text-text-muted">この科目にはキーワードがありません</p>
      ) : (
        <ul className="flex max-h-96 min-w-0 flex-col overflow-y-auto rounded border border-border">
          {rows.map(({ node, depth }) => (
            <li key={node.id} style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}>
              <label className="tap-target flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  className="focus-ring h-5 w-5 shrink-0"
                  checked={selected.has(node.id)}
                  onChange={() => toggle(node.id)}
                />
                <span className="min-w-0 break-words">{node.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {selectedIds.length === 0 ? (
        <p className="text-text-muted">キーワードが選ばれていません</p>
      ) : (
        <ul aria-label="選択済みのキーワード" className="flex min-w-0 flex-col gap-1 text-sm">
          {selectedIds.map((id) => (
            <li key={id} className="min-w-0 break-words">
              {keywordPath(keywords, id)
                .map((k) => k.name)
                .join(' / ') || '（削除されたキーワード）'}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

import { useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { buildKeywordTree, type KeywordNode, type KeywordTreeNode } from '@/lib/keywordTree';

type Props = {
  keywords: readonly KeywordNode[];
  /** 選択中のキーワード。null は科目全体（1.4） */
  value: string | null;
  onChange: (keywordId: string | null) => void;
  label?: string;
};

type Item = { id: string | null; name: string; depth: number };

const ROOT_KEY = '__subject__';
const keyOf = (id: string | null) => id ?? ROOT_KEY;

function flatten(nodes: KeywordTreeNode[], depth: number, out: Item[]): Item[] {
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

/**
 * 範囲のキーワードを1つ選ぶ木（role="tree"、単一選択）。先頭の「科目全体」は未選択を表す（1.2、1.4、10.4）。
 * 上下の矢印・Home・End でフォーカスを移し、Enter・Space で選ぶ。木は常に展開して表示する。
 */
export function KeywordScopePicker({ keywords, value, onChange, label = '範囲' }: Props): ReactElement {
  const items = useMemo(
    () => [{ id: null, name: '科目全体', depth: 0 } as Item, ...flatten(buildKeywordTree(keywords), 1, [])],
    [keywords],
  );
  const [focusKey, setFocusKey] = useState<string>(keyOf(value));
  const refs = useRef(new Map<string, HTMLLIElement>());
  const activeKey = items.some((i) => keyOf(i.id) === focusKey) ? focusKey : keyOf(value);

  const moveTo = (index: number) => {
    const item = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!item) return;
    const key = keyOf(item.id);
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, index: number, item: Item) => {
    switch (e.key) {
      case 'ArrowDown':
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        onChange(item.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <ul role="tree" aria-label={label} className="flex max-h-[60vh] min-w-0 flex-col gap-1 overflow-auto">
      {items.map((item, index) => {
        const key = keyOf(item.id);
        const selected = item.id === value;
        return (
          <li
            key={key}
            ref={(el) => {
              if (el) refs.current.set(key, el);
              else refs.current.delete(key);
            }}
            role="treeitem"
            aria-selected={selected}
            aria-level={item.depth + 1}
            tabIndex={key === activeKey ? 0 : -1}
            onClick={() => {
              setFocusKey(key);
              onChange(item.id);
            }}
            onFocus={() => setFocusKey(key)}
            onKeyDown={(e) => onKeyDown(e, index, item)}
            style={{ paddingLeft: `${item.depth * 1.25 + 0.5}rem` }}
            className={`tap-target focus-ring flex min-w-0 cursor-pointer items-center rounded border pr-2 break-words ${
              selected ? 'border-primary bg-primary font-bold text-bg' : 'border-transparent'
            }`}
          >
            {item.name}
          </li>
        );
      })}
    </ul>
  );
}

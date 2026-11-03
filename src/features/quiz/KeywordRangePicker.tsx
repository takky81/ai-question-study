import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';

import { buildKeywordTree, keywordPath, type KeywordNode, type KeywordTreeNode } from '../../lib/keywordTree';

type Props = {
  /** 科目のキーワード全件 */
  keywords: readonly KeywordNode[];
  /** 選択中のキーワード。null は「科目全体」 */
  selectedKeywordId: string | null;
  onSelect: (keywordId: string | null) => void;
  /** 木の見出し（tree のラベル） */
  label?: string;
};

/** 「科目全体」の行に使う内部 ID（キーワードの UUID とは衝突しない） */
const ALL = '__all__';

type Row = { id: string; parentId: string | null; node: KeywordTreeNode | null };

// 見えている行を前順に並べる（先頭は「科目全体」）。深い木でも再帰の上限に当たらないよう明示的なスタックを使う
function flatten(roots: KeywordTreeNode[], isOpen: (id: string) => boolean): Row[] {
  const rows: Row[] = [{ id: ALL, parentId: null, node: null }];
  const stack: { node: KeywordTreeNode; parentId: string | null }[] = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push({ node: roots[i]!, parentId: null });
  while (stack.length > 0) {
    const { node, parentId } = stack.pop()!;
    rows.push({ id: node.id, parentId, node });
    if (node.children.length > 0 && isOpen(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i]!, parentId: node.id });
    }
  }
  return rows;
}

/**
 * 出題範囲の木選択（1.2、1.4、1.9、10.3）。
 * 先頭の「科目全体」と科目のキーワード木を ARIA の tree パターンで表示し、1つを選ぶ。
 * 矢印キーで移動・展開・折りたたみ、Home／End で先頭・末尾、Enter／Space で選択する。
 */
export function KeywordRangePicker({ keywords, selectedKeywordId, onSelect, label = '出題範囲' }: Props): ReactElement {
  const baseId = useId();
  const roots = useMemo(() => buildKeywordTree(keywords), [keywords]);
  const selectedRowId = selectedKeywordId ?? ALL;

  // 選択中のキーワードの祖先を展開して見えるようにする（初期選択と外部からの変更）
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (selectedKeywordId === null) return;
    const ancestors = keywordPath(keywords, selectedKeywordId).slice(0, -1);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      if (ancestors.every((a) => prev.has(a.id))) return prev;
      const next = new Set(prev);
      for (const a of ancestors) next.add(a.id);
      return next;
    });
  }, [keywords, selectedKeywordId]);

  const rows = useMemo(() => flatten(roots, (id) => expanded.has(id)), [roots, expanded]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const pendingFocus = useRef<string | null>(null);

  // roving tabindex: フォーカス中の行、なければ選択中の行、なければ「科目全体」
  const isVisible = (id: string | null): id is string => id !== null && rows.some((r) => r.id === id);
  const tabStop = isVisible(focusedId) ? focusedId : isVisible(selectedRowId) ? selectedRowId : ALL;

  // 展開で新しく描画された行へも移動できるよう、描画後にフォーカスする
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    itemRefs.current.get(id)?.focus();
  });

  function select(rowId: string) {
    setFocusedId(rowId);
    onSelect(rowId === ALL ? null : rowId);
  }

  function moveFocus(id: string | null | undefined) {
    if (!id) return;
    pendingFocus.current = id;
    setFocusedId(id);
    itemRefs.current.get(id)?.focus();
  }

  function setOpen(id: string, open: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')?.dataset.id;
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    if (!row) return;
    const hasChildren = (row.node?.children.length ?? 0) > 0;
    const isOpen = expanded.has(row.id);
    switch (e.key) {
      case 'ArrowDown':
        moveFocus(rows[index + 1]?.id);
        break;
      case 'ArrowUp':
        moveFocus(rows[index - 1]?.id);
        break;
      case 'ArrowRight':
        if (hasChildren && !isOpen) setOpen(row.id, true);
        else if (hasChildren) moveFocus(row.node?.children[0]?.id);
        break;
      case 'ArrowLeft':
        if (hasChildren && isOpen) setOpen(row.id, false);
        else moveFocus(row.parentId);
        break;
      case 'Home':
        moveFocus(rows[0]?.id);
        break;
      case 'End':
        moveFocus(rows[rows.length - 1]?.id);
        break;
      case 'Enter':
      case ' ':
        select(row.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const itemProps = (id: string, name: string, level: number, isExpanded: boolean | undefined) => ({
    ref: (el: HTMLLIElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
    role: 'treeitem',
    'data-id': id,
    'aria-label': name,
    'aria-level': level,
    'aria-selected': id === selectedRowId,
    'aria-expanded': isExpanded,
    tabIndex: id === tabStop ? 0 : -1,
    onFocus: (e: FocusEvent<HTMLLIElement>) => {
      if (e.target === e.currentTarget) setFocusedId(id);
    },
    onClick: (e: MouseEvent<HTMLLIElement>) => {
      e.stopPropagation();
      select(id);
    },
    className: 'focus-ring min-w-0 rounded',
  });

  const rowClass = (id: string) =>
    `tap-target flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 ${
      id === selectedRowId ? 'bg-primary/15 font-bold' : 'hover:bg-surface'
    }`;

  const renderNodes = (nodes: KeywordTreeNode[], level: number): ReactElement[] =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isOpen = expanded.has(node.id);
      return (
        <li key={node.id} {...itemProps(node.id, node.name, level, hasChildren ? isOpen : undefined)}>
          <div className={rowClass(node.id)} style={{ paddingInlineStart: `${(level - 1) * 1.25 + 0.25}rem` }}>
            <span
              aria-hidden="true"
              className="inline-flex h-11 w-8 shrink-0 items-center justify-center text-text-muted"
              onClick={(e) => {
                if (!hasChildren) return;
                e.stopPropagation();
                setOpen(node.id, !isOpen);
                setFocusedId(node.id);
              }}
            >
              {hasChildren ? (isOpen ? '▾' : '▸') : '・'}
            </span>
            <span className="min-w-0 break-words">{node.name}</span>
          </div>
          {hasChildren && isOpen && (
            <ul role="group" className="min-w-0">
              {renderNodes(node.children, level + 1)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <div className="min-w-0">
      <h3 id={`${baseId}-h`} className="mb-1 break-words font-bold">
        {label}
      </h3>
      <ul role="tree" aria-labelledby={`${baseId}-h`} onKeyDown={onKeyDown} className="min-w-0">
        <li {...itemProps(ALL, '科目全体', 1, undefined)}>
          <div className={rowClass(ALL)} style={{ paddingInlineStart: '0.25rem' }}>
            <span aria-hidden="true" className="inline-flex h-11 w-8 shrink-0 items-center justify-center text-text-muted">
              ◎
            </span>
            <span className="min-w-0 break-words">科目全体</span>
          </div>
        </li>
        {renderNodes(roots, 1)}
      </ul>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  buildKeywordTree,
  keywordSubtreeIds,
  type KeywordTreeNode,
} from "../../lib/keywordTree";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  createKeyword,
  deleteKeyword,
  listKeywords,
  moveKeyword,
  previewKeywordDeletion,
  renameKeyword,
  reorderKeywords,
  type KeywordDeletionImpact,
} from "./api";
import type { Keyword } from "./types";

const EMPTY_NAME = "キーワード名を入力してください";
const DUPLICATE_SIBLING = "同じ親の下に同じ名前のキーワードがあります";
const ROOT_VALUE = "__root__";

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Props = {
  subjectId: string;
  /** 選択中のキーワード（問題一覧の絞り込みに使う） */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

/** 表示順（前順）に並べた行。展開中の子だけを含めると「見えている行」になる */
type Row = {
  node: KeywordTreeNode;
  level: number;
  parentId: string | null;
  path: string;
};

function flatten(
  roots: KeywordTreeNode[],
  isOpen: (id: string) => boolean,
): Row[] {
  const rows: Row[] = [];
  const walk = (
    nodes: KeywordTreeNode[],
    level: number,
    parentId: string | null,
    prefix: string,
  ) => {
    for (const node of nodes) {
      const path = prefix ? `${prefix} / ${node.name}` : node.name;
      rows.push({ node, level, parentId, path });
      if (node.children.length > 0 && isOpen(node.id))
        walk(node.children, level + 1, node.id, path);
    }
  };
  walk(roots, 1, null, "");
  return rows;
}

/**
 * 科目のキーワード木（3.1〜3.9、9.4）。
 * ARIA の tree パターン（矢印キーで移動・展開、Enter／Space で選択）で表示し、
 * 選択中のキーワードに対する操作（子の追加、改名、上へ／下へ、移動、削除）はボタンとフォームで行う。
 */
export function KeywordTree({
  subjectId,
  selectedId,
  onSelect,
}: Props): ReactElement {
  const baseId = useId();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [rootName, setRootName] = useState("");
  const [childName, setChildName] = useState("");
  const [newName, setNewName] = useState("");
  const [moveTarget, setMoveTarget] = useState(ROOT_VALUE);
  const [deleting, setDeleting] = useState<{
    keyword: Keyword;
    impact: KeywordDeletionImpact;
  } | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const pendingFocus = useRef(false);

  useEffect(() => setSelected(selectedId), [selectedId]);

  const reload = useCallback(async () => {
    try {
      setKeywords(await listKeywords(subjectId));
      setLoaded(true);
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, [subjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tree = useMemo(() => buildKeywordTree(keywords), [keywords]);
  const allRows = useMemo(() => flatten(tree, () => true), [tree]);
  const visibleRows = useMemo(
    () => flatten(tree, (id) => expanded.has(id)),
    [tree, expanded],
  );
  const byId = useMemo(
    () => new Map(keywords.map((kw) => [kw.id, kw])),
    [keywords],
  );
  const current = selected ? (byId.get(selected) ?? null) : null;

  // 再取得で選択中のキーワードが消えたら選択を外す
  useEffect(() => {
    if (loaded && selected && !byId.has(selected)) {
      setSelected(null);
      onSelect(null);
    }
  }, [loaded, byId, selected, onSelect]);

  // 選択が変わったら操作フォームを選択中のキーワードに合わせる
  useEffect(() => {
    setNewName(current?.name ?? "");
    setChildName("");
    setMoveTarget(ROOT_VALUE);
  }, [current?.id, current?.name]);

  // キー操作で移動したノードへフォーカスを移す
  useEffect(() => {
    if (!pendingFocus.current || !focusedId) return;
    pendingFocus.current = false;
    itemRefs.current.get(focusedId)?.focus();
  }, [focusedId, visibleRows]);

  const tabStop =
    focusedId && visibleRows.some((r) => r.node.id === focusedId)
      ? focusedId
      : (visibleRows.find((r) => r.node.id === selected)?.node.id ??
        visibleRows[0]?.node.id ??
        null);

  function siblingsOf(parentId: string | null): Keyword[] {
    return keywords
      .filter(
        (kw) =>
          kw.parentId === parentId ||
          (parentId === null && kw.parentId !== null && !byId.has(kw.parentId)),
      )
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  // 空・兄弟重複を保存前に検出する（3.4）。最終的な一意性は DB が保証する
  function nameError(
    name: string,
    parentId: string | null,
    selfId: string | null,
  ): string | null {
    if (!name) return EMPTY_NAME;
    if (siblingsOf(parentId).some((kw) => kw.id !== selfId && kw.name === name))
      return DUPLICATE_SIBLING;
    return null;
  }

  // 処理中の二重実行を防ぎ、失敗は日本語のエラーを表示して木を再取得する
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(messageOf(e));
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  function select(id: string) {
    setSelected(id);
    setFocusedId(id);
    setError(null);
    onSelect(id);
  }

  function moveFocus(id: string | undefined) {
    if (!id) return;
    pendingFocus.current = true;
    setFocusedId(id);
  }

  function setOpen(id: string, open: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onTreeKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const id = (e.target as HTMLElement).closest<HTMLElement>(
      '[role="treeitem"]',
    )?.dataset.id;
    const index = visibleRows.findIndex((r) => r.node.id === id);
    const row = visibleRows[index];
    if (!row) return;
    const hasChildren = row.node.children.length > 0;
    const isOpen = expanded.has(row.node.id);
    switch (e.key) {
      case "ArrowDown":
        moveFocus(visibleRows[index + 1]?.node.id);
        break;
      case "ArrowUp":
        moveFocus(visibleRows[index - 1]?.node.id);
        break;
      case "ArrowRight":
        if (hasChildren && !isOpen) setOpen(row.node.id, true);
        else if (hasChildren) moveFocus(row.node.children[0]?.id);
        break;
      case "ArrowLeft":
        if (hasChildren && isOpen) setOpen(row.node.id, false);
        else moveFocus(row.parentId ?? undefined);
        break;
      case "Home":
        moveFocus(visibleRows[0]?.node.id);
        break;
      case "End":
        moveFocus(visibleRows[visibleRows.length - 1]?.node.id);
        break;
      case "Enter":
      case " ":
        select(row.node.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  async function onAddRoot(e: FormEvent) {
    e.preventDefault();
    const name = rootName.trim();
    const invalid = nameError(name, null, null);
    if (invalid) {
      setError(invalid);
      return;
    }
    const ok = await run(async () => {
      await createKeyword(subjectId, null, name);
      await reload();
    });
    if (ok) setRootName("");
  }

  async function onAddChild(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    const name = childName.trim();
    const invalid = nameError(name, current.id, null);
    if (invalid) {
      setError(invalid);
      return;
    }
    const ok = await run(async () => {
      await createKeyword(subjectId, current.id, name);
      await reload();
    });
    if (ok) {
      setChildName("");
      setOpen(current.id, true);
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    const name = newName.trim();
    const invalid = nameError(name, current.parentId, current.id);
    if (invalid) {
      setError(invalid);
      return;
    }
    await run(async () => {
      await renameKeyword(current.id, name);
      await reload();
    });
  }

  async function onReorder(offset: -1 | 1) {
    if (!current) return;
    const ids = siblingsOf(current.parentId).map((kw) => kw.id);
    const i = ids.indexOf(current.id);
    const j = i + offset;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    await run(async () => {
      await reorderKeywords(subjectId, current.parentId, ids);
      await reload();
    });
  }

  async function onMove(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    const parentId = moveTarget === ROOT_VALUE ? null : moveTarget;
    const ok = await run(async () => {
      await moveKeyword(current.id, parentId);
      await reload();
    });
    if (ok && parentId) setOpen(parentId, true);
  }

  async function onAskDelete() {
    if (!current) return;
    const keyword = current;
    await run(async () => {
      const impact = await previewKeywordDeletion(keyword.id);
      setDeleting({ keyword, impact });
    });
  }

  async function onConfirmDelete() {
    if (!deleting) return;
    const ok = await run(async () => {
      await deleteKeyword(deleting.keyword.id);
      await reload();
    });
    if (ok) setDeleting(null);
  }

  // 移動先の候補: 科目の直下と、自分と配下を除いたキーワード（3.7）
  const moveCandidates = useMemo(() => {
    if (!current) return [];
    const excluded = new Set(keywordSubtreeIds(keywords, current.id));
    return allRows.filter((r) => !excluded.has(r.node.id));
  }, [allRows, current, keywords]);

  const siblingIds = current
    ? siblingsOf(current.parentId).map((kw) => kw.id)
    : [];
  const siblingIndex = current ? siblingIds.indexOf(current.id) : -1;

  const renderNodes = (
    nodes: KeywordTreeNode[],
    level: number,
  ): ReactElement[] =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isOpen = expanded.has(node.id);
      const isSelected = node.id === selected;
      return (
        <li
          key={node.id}
          ref={(el) => {
            if (el) itemRefs.current.set(node.id, el);
            else itemRefs.current.delete(node.id);
          }}
          role="treeitem"
          data-id={node.id}
          aria-label={node.name}
          aria-level={level}
          aria-selected={isSelected}
          aria-expanded={hasChildren ? isOpen : undefined}
          tabIndex={node.id === tabStop ? 0 : -1}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocusedId(node.id);
          }}
          onClick={(e) => {
            e.stopPropagation();
            select(node.id);
          }}
          className="focus-ring min-w-0 rounded"
        >
          <div
            className={`tap-target flex min-w-0 items-center gap-1 rounded px-1 ${
              isSelected ? "bg-primary/15 font-bold" : "hover:bg-surface"
            }`}
            style={{ paddingInlineStart: `${(level - 1) * 1.25 + 0.25}rem` }}
          >
            <span
              aria-hidden="true"
              className="inline-flex h-11 w-8 shrink-0 cursor-pointer items-center justify-center text-text-muted"
              onClick={(e) => {
                if (!hasChildren) return;
                e.stopPropagation();
                setOpen(node.id, !isOpen);
                setFocusedId(node.id);
              }}
            >
              {hasChildren ? (isOpen ? "▾" : "▸") : "・"}
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

  const inputClass =
    "tap-target focus-ring min-w-0 flex-1 rounded border border-border bg-bg px-2";
  const buttonClass =
    "tap-target focus-ring rounded border px-3 disabled:opacity-50";

  return (
    <section
      aria-labelledby={`${baseId}-h`}
      className="flex min-w-0 flex-col gap-3"
    >
      <h2 id={`${baseId}-h`} className="text-lg font-bold">
        キーワード
      </h2>

      <form
        onSubmit={onAddRoot}
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        <input
          aria-label="科目の直下に追加するキーワード名"
          placeholder="新しいキーワード名"
          value={rootName}
          onChange={(e) => setRootName(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={busy}
          className={`${buttonClass} border-primary`}
        >
          直下に追加
        </button>
      </form>

      {error && !deleting && (
        <p role="alert" className="break-words text-warn">
          {error}
        </p>
      )}
      {loadError && (
        <p role="alert" className="break-words text-warn">
          {loadError}
        </p>
      )}

      {tree.length === 0 && !loadError ? (
        <p className="text-text-muted">キーワードはまだありません</p>
      ) : (
        <ul
          role="tree"
          aria-labelledby={`${baseId}-h`}
          onKeyDown={onTreeKeyDown}
          className="min-w-0"
        >
          {renderNodes(tree, 1)}
        </ul>
      )}

      {current && (
        <div
          role="group"
          aria-label={`「${current.name}」の操作`}
          className="flex min-w-0 flex-col gap-2 rounded border border-border bg-surface p-2"
        >
          <p className="break-words font-bold">選択中: {current.name}</p>

          <form
            onSubmit={onAddChild}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <input
              aria-label={`「${current.name}」の子として追加する名前`}
              placeholder="子キーワード名"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={busy}
              className={`${buttonClass} border-primary`}
            >
              子を追加
            </button>
          </form>

          <form
            onSubmit={onRename}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <input
              aria-label={`「${current.name}」の新しい名前`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={busy}
              className={`${buttonClass} border-border`}
            >
              名前を変更
            </button>
          </form>

          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || siblingIndex <= 0}
              onClick={() => void onReorder(-1)}
              className={`${buttonClass} border-border`}
            >
              上へ
            </button>
            <button
              type="button"
              disabled={
                busy ||
                siblingIndex < 0 ||
                siblingIndex >= siblingIds.length - 1
              }
              onClick={() => void onReorder(1)}
              className={`${buttonClass} border-border`}
            >
              下へ
            </button>
          </div>

          <form
            onSubmit={onMove}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <select
              aria-label={`「${current.name}」の移動先`}
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className={`${inputClass} w-full`}
            >
              <option value={ROOT_VALUE}>（科目の直下）</option>
              {moveCandidates.map((r) => (
                <option key={r.node.id} value={r.node.id}>
                  {r.path}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy}
              className={`${buttonClass} border-border`}
            >
              移動
            </button>
          </form>

          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAskDelete()}
              className={`${buttonClass} border-warn text-warn`}
            >
              削除
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `キーワード「${deleting.keyword.name}」を削除` : ""}
        message={
          deleting && (
            <>
              <p>
                配下を含むキーワード {deleting.impact.keywordCount}{" "}
                件を削除します。
              </p>
              <p className="mt-1">
                紐づけが外れる問題 {deleting.impact.unlinkedQuestionCount}{" "}
                件のうち、紐づくキーワードがなくなり無効化される問題{" "}
                {deleting.impact.disabledQuestionCount} 件があります。
              </p>
              <p className="mt-1">削除すると元に戻せません。</p>
            </>
          )
        }
        confirmLabel="削除する"
        danger
        busy={busy}
        error={deleting ? error : null}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => {
          setDeleting(null);
          setError(null);
        }}
      />
    </section>
  );
}

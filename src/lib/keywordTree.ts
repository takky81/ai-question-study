// キーワード階層の共通関数（純粋関数）。feature を import しない。
// 入力は科目のキーワード全件を想定し、循環や親の欠落があっても停止する。

export type KeywordNode = { id: string; parentId: string | null; name: string; sortOrder: number };
export type KeywordTreeNode = KeywordNode & { children: KeywordTreeNode[] };

// 兄弟の並び: sortOrder、同値は id 順
function compareSiblings(a: KeywordNode, b: KeywordNode): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ID で引ける表（同じ ID が重複したら先勝ち）
function indexById(nodes: readonly KeywordNode[]): Map<string, KeywordNode> {
  const byId = new Map<string, KeywordNode>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  return byId;
}

// 親 ID ごとの子一覧（兄弟順に整列済み）
function childrenByParent(byId: Map<string, KeywordNode>): Map<string, KeywordNode[]> {
  const children = new Map<string, KeywordNode[]>();
  for (const n of byId.values()) {
    if (n.parentId === null || !byId.has(n.parentId)) continue;
    const list = children.get(n.parentId);
    if (list) list.push(n);
    else children.set(n.parentId, [n]);
  }
  for (const list of children.values()) list.sort(compareSiblings);
  return children;
}

// 兄弟順の木を返す。親が見つからないノードは根とする。
// 循環のため根から辿れないノードは、兄弟順で最初に見つかったものを根として補い、全ノードを1回ずつ含める。
export function buildKeywordTree(nodes: readonly KeywordNode[]): KeywordTreeNode[] {
  const byId = indexById(nodes);
  const children = childrenByParent(byId);
  const visited = new Set<string>();

  // 明示的なスタックで構築する（深い木でも再帰の上限に当たらない）
  const build = (root: KeywordNode): KeywordTreeNode => {
    visited.add(root.id);
    const rootNode: KeywordTreeNode = { ...root, children: [] };
    const stack: KeywordTreeNode[] = [rootNode];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of children.get(current.id) ?? []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        const childNode: KeywordTreeNode = { ...child, children: [] };
        current.children.push(childNode);
        stack.push(childNode);
      }
    }
    return rootNode;
  };

  const sorted = [...byId.values()].sort(compareSiblings);
  const roots: KeywordTreeNode[] = [];
  for (const n of sorted) {
    if (n.parentId === null || !byId.has(n.parentId)) roots.push(build(n));
  }
  for (const n of sorted) {
    if (!visited.has(n.id)) roots.push(build(n));
  }
  return roots;
}

// 根から id までのノードを順に返す。存在しない id は []。循環は訪問済み集合で打ち切る。
export function keywordPath(nodes: readonly KeywordNode[], id: string): KeywordNode[] {
  const byId = indexById(nodes);
  const path: KeywordNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path.reverse();
}

// 自身を先頭に幅優先で配下の ID を重複なく返す。存在しない id は []。
// DB の keyword_subtree_ids（自身＋子孫、重複なし）と同じ集合を返す。
export function keywordSubtreeIds(nodes: readonly KeywordNode[], id: string): string[] {
  const byId = indexById(nodes);
  if (!byId.has(id)) return [];
  const children = childrenByParent(byId);
  const result: string[] = [id];
  const visited = new Set<string>([id]);
  // result 自体を幅優先のキューとして使う
  for (let i = 0; i < result.length; i++) {
    const current = result[i] as string;
    for (const child of children.get(current) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      result.push(child.id);
    }
  }
  return result;
}

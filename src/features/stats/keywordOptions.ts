// キーワード木を字下げ付きの選択肢へ平坦化する（1.3）。
import { buildKeywordTree, type KeywordNode, type KeywordTreeNode } from '@/lib/keywordTree';

export type KeywordOption = { id: string; label: string; depth: number };

const INDENT = '　　'; // 深さ1つにつき全角空白2文字

// 深さ優先（兄弟は木の順）。明示的なスタックで深い木でも再帰の上限に当たらない。
export function toKeywordOptions(nodes: readonly KeywordNode[]): KeywordOption[] {
  const options: KeywordOption[] = [];
  const stack: { node: KeywordTreeNode; depth: number }[] = buildKeywordTree(nodes)
    .reverse()
    .map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    options.push({ id: node.id, label: INDENT.repeat(depth) + node.name, depth });
    for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i]!, depth: depth + 1 });
  }
  return options;
}

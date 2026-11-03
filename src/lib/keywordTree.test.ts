import { describe, expect, it } from 'vitest';
import {
  buildKeywordTree,
  keywordPath,
  keywordSubtreeIds,
  type KeywordNode,
  type KeywordTreeNode,
} from './keywordTree';

function node(id: string, parentId: string | null, sortOrder = 0, name = id): KeywordNode {
  return { id, parentId, name, sortOrder };
}

// 木を深さ優先で平坦化した ID 列
function flatten(tree: KeywordTreeNode[]): string[] {
  return tree.flatMap((n) => [n.id, ...flatten(n.children)]);
}

// 深さ5の一本道: k1 > k2 > k3 > k4 > k5
const chain = [node('k5', 'k4'), node('k3', 'k2'), node('k1', null), node('k4', 'k3'), node('k2', 'k1')];

describe('buildKeywordTree', () => {
  it('兄弟を sortOrder 順、同値は id 順に並べる', () => {
    const tree = buildKeywordTree([
      node('c', null, 2),
      node('b', null, 1),
      node('a', null, 1),
      node('x2', 'a', 0),
      node('x1', 'a', 0),
      node('x0', 'a', 5),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(['x1', 'x2', 'x0']);
  });

  it('親が見つからないノードは根として扱う', () => {
    const tree = buildKeywordTree([node('a', null, 1), node('orphan', 'missing', 0)]);
    expect(tree.map((n) => n.id)).toEqual(['orphan', 'a']);
  });

  it('入力配列を変更しない', () => {
    const input = [node('b', null, 1), node('a', null, 0)];
    const copy = structuredClone(input);
    buildKeywordTree(input);
    expect(input).toEqual(copy);
  });

  it('1,500 ノードで欠落・重複がない', () => {
    const nodes: KeywordNode[] = [];
    for (let i = 0; i < 1500; i++) {
      nodes.push(node(`n${i}`, i === 0 ? null : `n${Math.floor((i - 1) / 3)}`, 1500 - i));
    }
    const ids = flatten(buildKeywordTree(nodes));
    expect(ids).toHaveLength(1500);
    expect(new Set(ids).size).toBe(1500);
  });

  it('循環データでも停止し、全ノードを1回ずつ含める', () => {
    const ids = flatten(buildKeywordTree([node('r', null), node('a', 'b'), node('b', 'a'), node('s', 's')]));
    expect(ids.sort()).toEqual(['a', 'b', 'r', 's']);
  });
});

describe('keywordPath', () => {
  it('深さ5のノードについて根からのパスを返す', () => {
    expect(keywordPath(chain, 'k5').map((n) => n.id)).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
  });

  it('根なら自身のみを返す', () => {
    expect(keywordPath(chain, 'k1').map((n) => n.id)).toEqual(['k1']);
  });

  it('存在しない ID は空配列', () => {
    expect(keywordPath(chain, 'nope')).toEqual([]);
  });

  it('親が見つからないノードはそこを根とする', () => {
    expect(keywordPath([node('a', 'missing'), node('b', 'a')], 'b').map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('循環データでも停止し、重複を含めない', () => {
    const path = keywordPath([node('a', 'b'), node('b', 'c'), node('c', 'a')], 'a').map((n) => n.id);
    expect(path).toEqual(['c', 'b', 'a']);
  });
});

describe('keywordSubtreeIds', () => {
  it('自身を先頭に幅優先で配下の ID を返す', () => {
    const nodes = [node('r', null), node('a', 'r', 1), node('b', 'r', 0), node('a1', 'a'), node('b1', 'b')];
    expect(keywordSubtreeIds(nodes, 'r')).toEqual(['r', 'b', 'a', 'b1', 'a1']);
    expect(keywordSubtreeIds(nodes, 'a')).toEqual(['a', 'a1']);
  });

  it('葉なら自身のみを返す', () => {
    expect(keywordSubtreeIds(chain, 'k5')).toEqual(['k5']);
  });

  it('存在しない ID は空配列', () => {
    expect(keywordSubtreeIds(chain, 'nope')).toEqual([]);
  });

  it('1,500 ノードで欠落・重複がない', () => {
    const nodes: KeywordNode[] = [node('root', null)];
    for (let i = 0; i < 1499; i++) nodes.push(node(`n${i}`, i === 0 ? 'root' : `n${Math.floor(i / 2)}`));
    const ids = keywordSubtreeIds(nodes, 'root');
    expect(ids).toHaveLength(1500);
    expect(new Set(ids).size).toBe(1500);
  });

  it('循環データでも停止し、重複を含めない', () => {
    const ids = keywordSubtreeIds([node('a', 'c'), node('b', 'a'), node('c', 'b')], 'a');
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

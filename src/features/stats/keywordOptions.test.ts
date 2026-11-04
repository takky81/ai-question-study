import { describe, expect, it } from 'vitest';
import { toKeywordOptions } from './keywordOptions';

describe('toKeywordOptions', () => {
  it('空配列は空', () => {
    expect(toKeywordOptions([])).toEqual([]);
  });

  it('3階層の木を深さ優先・兄弟順で字下げ付きに平坦化する', () => {
    const nodes = [
      { id: 'c', parentId: 'a', name: 'C', sortOrder: 2 },
      { id: 'b', parentId: null, name: 'B', sortOrder: 2 },
      { id: 'd', parentId: 'c', name: 'D', sortOrder: 1 },
      { id: 'a', parentId: null, name: 'A', sortOrder: 1 },
      { id: 'e', parentId: 'a', name: 'E', sortOrder: 1 },
    ];
    expect(toKeywordOptions(nodes)).toEqual([
      { id: 'a', label: 'A', depth: 0 },
      { id: 'e', label: '　　E', depth: 1 },
      { id: 'c', label: '　　C', depth: 1 },
      { id: 'd', label: '　　　　D', depth: 2 },
      { id: 'b', label: 'B', depth: 0 },
    ]);
  });
});

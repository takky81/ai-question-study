import { describe, expect, it } from 'vitest';
import type { Keyword } from '@/features/catalog/types';
import { computeImportDiff } from './diff';
import type { ImportFileV1 } from './format';
import type { ImportSnapshot, SnapshotQuestion } from './importValidate';
import { buildApplyPayload } from './plan';

const kw = (id: string, parentId: string | null, name: string): Keyword & { updatedAt: string } => ({
  id,
  parentId,
  name,
  sortOrder: 0,
  subjectId: 's1',
  updatedAt: `2026-10-0${id.length}T00:00:00.000Z-${id}`,
});
const kwAt = (id: string) => `2026-10-0${id.length}T00:00:00.000Z-${id}`;

const choices = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, body: `選択肢${i + 1}`, explanation: `解説${i + 1}`, isCorrect: i === 0 }));

const sq = (id: string, over: Partial<SnapshotQuestion> = {}): SnapshotQuestion => ({
  id,
  subjectId: 's1',
  kind: 'feature',
  stem: '問題文',
  explanation: '解説',
  keywordIds: ['root'],
  choices: choices(2),
  status: 'active',
  updatedAt: `qat-${id}`,
  ...over,
});

const snapshot = (): ImportSnapshot => ({
  subject: { id: 's1', name: '科目', deleted: false },
  keywords: [kw('root', null, 'ルート'), kw('a', 'root', 'A'), kw('b', 'a', 'B'), kw('c', 'root', 'C'), kw('d', null, 'D')],
  foreignKeywordIds: new Set(),
  questions: new Map([
    ['q1', sq('q1')],
    ['q2', sq('q2')],
    ['q3', sq('q3')],
    ['qx', sq('qx', { status: 'disabled' })],
  ]),
  openFlags: new Map(),
});

const update = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'feature' as const,
  stem: '問題文',
  explanation: '解説',
  keywords: [{ id: 'root' }],
  choices: choices(2),
  ...over,
});

const file = (k: Partial<ImportFileV1['keywords']>, q: Partial<ImportFileV1['questions']>): ImportFileV1 => ({
  format: 'ai-question-study/import',
  version: 1,
  subjectId: 's1',
  basedOnExportedAt: null,
  keywords: { add: [], rename: [], move: [], ...k },
  questions: { update: [], create: [], disable: [], ...q },
});

const build = (f: ImportFileV1) => {
  const s = snapshot();
  return buildApplyPayload(f, s, computeImportDiff(f, s));
};

describe('buildApplyPayload', () => {
  it('キーワード追加は親が先になる順に並べ、一時キーの親は parentTempKey で表す', () => {
    const p = build(
      file(
        {
          add: [
            { tempKey: 'k2', parent: { tempKey: 'k1' }, name: '孫' },
            { tempKey: 'k1', parent: { id: 'a' }, name: '子' },
            { tempKey: 'k0', parent: null, name: '直下' },
          ],
        },
        {},
      ),
    );
    expect(p.subjectId).toBe('s1');
    expect(p.keywordAdds).toEqual([
      { tempKey: 'k1', parentId: 'a', parentTempKey: null, name: '子' },
      { tempKey: 'k2', parentId: null, parentTempKey: 'k1', name: '孫' },
      { tempKey: 'k0', parentId: null, parentTempKey: null, name: '直下' },
    ]);
    expect(p.expected.keywords).toEqual([{ id: 'a', updatedAt: kwAt('a') }]);
  });

  it('改名・移動は変化のあるものだけを含め、移動は差分の順（浅い順）を保つ', () => {
    const p = build(
      file(
        {
          add: [{ tempKey: 'n', parent: null, name: 'N' }],
          rename: [{ id: 'a', name: 'A2' }, { id: 'c', name: 'C' }],
          move: [
            { id: 'b', parent: { id: 'c' } },
            { id: 'c', parent: { tempKey: 'n' } },
            { id: 'd', parent: null },
          ],
        },
        {},
      ),
    );
    expect(p.keywordRenames).toEqual([{ id: 'a', name: 'A2' }]);
    expect(p.keywordMoves).toEqual([
      { id: 'c', parentId: null, parentTempKey: 'n' },
      { id: 'b', parentId: 'c', parentTempKey: null },
    ]);
    expect(new Set(p.expected.keywords.map((k) => k.id))).toEqual(new Set(['a', 'b', 'c']));
    for (const k of p.expected.keywords) expect(k.updatedAt).toBe(kwAt(k.id));
  });

  it('問題の修正・新規・無効化を作り、解消の対象は修正された問題だけ', () => {
    const p = build(
      file(
        { add: [{ tempKey: 'k1', parent: null, name: 'X' }] },
        {
          update: [update('q1', { explanation: '新しい解説', keywords: [{ id: 'b' }, { tempKey: 'k1' }] }), update('q2')],
          create: [
            { tempKey: 'n1', kind: 'feature', stem: '新規', explanation: '', keywords: [{ tempKey: 'k1' }, { id: 'c' }], choices: [{ body: 'x', explanation: '', isCorrect: true }] },
            { kind: 'feature', stem: '新規2', explanation: '', keywords: [], choices: [{ body: 'y', explanation: '', isCorrect: true }] },
          ],
          disable: [{ id: 'q3', reason: '古い' }, { id: 'qx', reason: null }],
        },
      ),
    );
    expect(p.questionUpdates).toEqual([
      {
        input: {
          id: 'q1',
          subjectId: 's1',
          kind: 'feature',
          stem: '問題文',
          explanation: '新しい解説',
          keywordIds: ['b', 'tmp:k1'],
          choices: [
            { id: 'c1', body: '選択肢1', explanation: '解説1', isCorrect: true },
            { id: 'c2', body: '選択肢2', explanation: '解説2', isCorrect: false },
          ],
        },
      },
    ]);
    expect(p.questionCreates).toEqual([
      {
        tempKey: 'n1',
        input: { id: null, subjectId: 's1', kind: 'feature', stem: '新規', explanation: '', keywordIds: ['tmp:k1', 'c'], choices: [{ id: null, body: 'x', explanation: '', isCorrect: true }] },
      },
      {
        tempKey: 'q1',
        input: { id: null, subjectId: 's1', kind: 'feature', stem: '新規2', explanation: '', keywordIds: [], choices: [{ id: null, body: 'y', explanation: '', isCorrect: true }] },
      },
    ]);
    expect(p.questionDisables).toEqual([{ id: 'q3', reason: '古い' }]);
    expect(p.modifiedQuestionIds).toEqual(['q1']);
    expect(p.expected.questions).toEqual([
      { id: 'q1', updatedAt: 'qat-q1' },
      { id: 'q3', updatedAt: 'qat-q3' },
    ]);
    expect(p.expected.keywords).toEqual([
      { id: 'b', updatedAt: kwAt('b') },
      { id: 'c', updatedAt: kwAt('c') },
    ]);
  });

  it('変化がなければ空のペイロードになる', () => {
    const p = build(file({ rename: [{ id: 'a', name: 'A' }], move: [{ id: 'b', parent: { id: 'a' } }] }, { update: [update('q1')] }));
    expect(p).toMatchObject({
      keywordAdds: [],
      keywordRenames: [],
      keywordMoves: [],
      questionUpdates: [],
      questionCreates: [],
      questionDisables: [],
      modifiedQuestionIds: [],
      expected: { keywords: [], questions: [] },
    });
  });
});

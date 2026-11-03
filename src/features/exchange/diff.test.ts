import { describe, expect, it } from 'vitest';
import type { Keyword } from '@/features/catalog/types';
import { computeImportDiff, isQuestionModified } from './diff';
import type { ImportFileV1 } from './format';
import type { ImportSnapshot, SnapshotQuestion } from './importValidate';

const kw = (id: string, parentId: string | null, name: string, updatedAt = '2026-11-01T00:00:00.000Z') =>
  ({ id, parentId, name, sortOrder: 0, subjectId: 's1', updatedAt }) as Keyword;

const choices = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    body: `選択肢${i + 1}`,
    explanation: `解説${i + 1}`,
    isCorrect: i === 0,
  }));

const sq = (id: string, over: Partial<SnapshotQuestion> = {}): SnapshotQuestion => ({
  id,
  subjectId: 's1',
  kind: 'feature',
  stem: '問題文',
  explanation: '解説',
  keywordIds: ['root'],
  choices: choices(4),
  status: 'active',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

function snapshot(over: Partial<ImportSnapshot> = {}): ImportSnapshot {
  return {
    subject: { id: 's1', name: '科目', deleted: false },
    keywords: [kw('root', null, 'ルート'), kw('a', 'root', 'A'), kw('b', 'a', 'B'), kw('c', 'root', 'C')],
    foreignKeywordIds: new Set(),
    questions: new Map([
      ['q1', sq('q1')],
      ['q2', sq('q2')],
      ['qx', sq('qx', { status: 'disabled' })],
    ]),
    openFlags: new Map([['q1', [{ flag: 'wrong_answer' as never, note: 'x', createdAt: '2026-10-01T00:00:00.000Z' }]]]),
    ...over,
  };
}

type Ops = {
  keywords?: Partial<ImportFileV1['keywords']>;
  questions?: Partial<ImportFileV1['questions']>;
  basedOnExportedAt?: string | null;
};

function file(ops: Ops = {}): ImportFileV1 {
  return {
    format: 'ai-question-study/import',
    version: 1,
    subjectId: 's1',
    basedOnExportedAt: ops.basedOnExportedAt ?? null,
    keywords: { add: [], rename: [], move: [], ...ops.keywords },
    questions: { update: [], create: [], disable: [], ...ops.questions },
  };
}

const update = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'feature' as const,
  stem: '問題文',
  explanation: '解説',
  keywords: [{ id: 'root' }],
  choices: choices(4),
  ...over,
});

describe('isQuestionModified', () => {
  const before = sq('q1');
  it('同一なら偽、前後空白だけの違いも偽', () => {
    expect(isQuestionModified(before, update('q1'))).toBe(false);
    expect(
      isQuestionModified(
        before,
        update('q1', {
          stem: ' 問題文 ',
          explanation: '解説\n',
          choices: choices(4).map((c) => ({ ...c, body: ` ${c.body}` })),
        }),
      ),
    ).toBe(false);
  });
  it('解説だけの変更は真', () => {
    expect(isQuestionModified(before, update('q1', { explanation: '新しい解説' }))).toBe(true);
  });
  it('種別・紐づけ・選択肢の変更は真', () => {
    expect(isQuestionModified(before, update('q1', { kind: 'keyword' }))).toBe(true);
    expect(isQuestionModified(before, update('q1', { keywords: [{ id: 'a' }] }))).toBe(true);
    expect(isQuestionModified(before, update('q1', { choices: [...choices(4)].reverse() }))).toBe(true);
    expect(isQuestionModified(before, update('q1', { choices: choices(3) }))).toBe(true);
    const c = choices(4);
    expect(isQuestionModified(before, update('q1', { choices: c.map((x, i) => ({ ...x, isCorrect: i === 1 })) }))).toBe(true);
    expect(isQuestionModified(before, update('q1', { choices: [...c, { body: '新', explanation: '', isCorrect: false }] }))).toBe(true);
  });
  it('紐づけは集合として比較する', () => {
    const b = sq('q1', { keywordIds: ['a', 'c'] });
    expect(isQuestionModified(b, update('q1', { keywords: [{ id: 'c' }, { id: 'a' }] }))).toBe(false);
  });
});

describe('computeImportDiff', () => {
  it('解説だけの修正は updated に入り、変更なしは unchanged に入る', () => {
    const d = computeImportDiff(
      file({ questions: { update: [update('q1', { explanation: '新' }), update('q2', { stem: ' 問題文 ' })] } }),
      snapshot(),
    );
    expect(d.updated.map((u) => u.id)).toEqual(['q1']);
    expect(d.updated[0]?.fields).toEqual(['explanation']);
    expect(d.updated[0]?.choices).toEqual([]);
    expect(d.unchanged).toEqual(['q2']);
    expect(d.counts.questionsUpdated).toBe(1);
  });

  it('解消予定のフラグは修正された問題の未解消フラグ', () => {
    const d = computeImportDiff(file({ questions: { update: [update('q1', { stem: '新' })] } }), snapshot());
    expect(d.updated[0]?.flagsToResolve).toHaveLength(1);
    const d2 = computeImportDiff(file({ questions: { update: [update('q2', { stem: '新' })] } }), snapshot());
    expect(d2.updated[0]?.flagsToResolve).toEqual([]);
  });

  it('選択肢の追加・削除・変更・並べ替えを検出する', () => {
    const [c1, c2, c3] = choices(4);
    const after = [
      { ...c2!, isCorrect: true },
      { ...c1!, body: '変更', isCorrect: false },
      c3!,
      { body: '新しい', explanation: '', isCorrect: false },
    ];
    const d = computeImportDiff(file({ questions: { update: [update('q1', { choices: after })] } }), snapshot());
    const ch = d.updated[0]!.choices;
    expect(ch).toContainEqual(expect.objectContaining({ type: 'added', index: 3 }));
    expect(ch).toContainEqual(expect.objectContaining({ type: 'removed', before: expect.objectContaining({ id: 'c4' }) }));
    expect(ch).toContainEqual(expect.objectContaining({ type: 'changed', id: 'c1', fields: ['body', 'isCorrect'] }));
    expect(ch).toContainEqual(expect.objectContaining({ type: 'changed', id: 'c2', fields: ['isCorrect'] }));
    expect(ch).toContainEqual({ type: 'moved', id: 'c1', fromIndex: 0, toIndex: 1 });
    expect(ch).not.toContainEqual(expect.objectContaining({ type: 'moved', id: 'c3' }));
  });

  it('キーワードの追加・改名・移動を階層パスで返し、同名への改名と同じ親への移動は数えない', () => {
    const d = computeImportDiff(
      file({
        keywords: {
          add: [{ tempKey: 'k1', parent: { id: 'c' }, name: '新規' }],
          rename: [
            { id: 'a', name: 'A2' },
            { id: 'c', name: ' C ' },
          ],
          move: [
            { id: 'b', parent: { id: 'c' } },
            { id: 'c', parent: { id: 'root' } },
          ],
        },
      }),
      snapshot(),
    );
    expect(d.keywords).toEqual([
      { type: 'added', tempKey: 'k1', afterPath: ['ルート', 'C', '新規'] },
      { type: 'renamed', id: 'a', beforePath: ['ルート', 'A'], afterPath: ['ルート', 'A2'] },
      { type: 'moved', id: 'b', beforePath: ['ルート', 'A', 'B'], afterPath: ['ルート', 'C', 'B'] },
    ]);
    expect(d.counts).toMatchObject({ keywordsAdded: 1, keywordsRenamed: 1, keywordsMoved: 1 });
  });

  it('親の入れ替え（A/B）は移動後の深さが浅い順に並べ、途中で循環しない', () => {
    const d = computeImportDiff(
      file({
        keywords: {
          move: [
            { id: 'a', parent: { id: 'b' } },
            { id: 'b', parent: { id: 'root' } },
          ],
        },
      }),
      snapshot(),
    );
    const moves = d.keywords.filter((k) => k.type === 'moved');
    expect(moves.map((m) => ('id' in m ? m.id : ''))).toEqual(['b', 'a']);
    expect(moves[1]).toMatchObject({ beforePath: ['ルート', 'A'], afterPath: ['ルート', 'B', 'A'] });
    // 配列順に1件ずつ適用しても各段階で循環しない
    const tree = new Map(snapshot().keywords.map((k) => [k.id, k.parentId]));
    const parentOf = { a: 'b', b: 'root' } as Record<string, string>;
    for (const m of moves) {
      const id = 'id' in m ? m.id : '';
      tree.set(id, parentOf[id] ?? null);
      let cur: string | null | undefined = id;
      const seen = new Set<string>();
      while (cur) {
        expect(seen.has(cur)).toBe(false);
        seen.add(cur);
        cur = tree.get(cur);
      }
    }
  });

  it('新規は階層パス付き、無効化はすでに無効なら件数に入れない', () => {
    const d = computeImportDiff(
      file({
        keywords: { add: [{ tempKey: 'k1', parent: { id: 'a' }, name: 'N' }] },
        questions: {
          create: [
            {
              tempKey: 'n1',
              kind: 'feature',
              stem: '新問',
              explanation: '',
              keywords: [{ tempKey: 'k1' }, { id: 'c' }],
              choices: choices(4).map(({ id: _id, ...c }) => c),
            },
          ],
          disable: [
            { id: 'q2', reason: '古い' },
            { id: 'qx', reason: null },
          ],
        },
      }),
      snapshot(),
    );
    expect(d.created[0]).toMatchObject({ index: 0, tempKey: 'n1', keywordPaths: [['ルート', 'A', 'N'], ['ルート', 'C']] });
    expect(d.disabled).toEqual([
      { id: 'q2', stem: '問題文', reason: '古い', alreadyDisabled: false },
      { id: 'qx', stem: '問題文', reason: null, alreadyDisabled: true },
    ]);
    expect(d.counts).toMatchObject({ questionsCreated: 1, questionsDisabled: 1 });
  });

  it('出力日時より後に更新された対象に警告を付ける（日時は Date.parse で比べる）', () => {
    const snap = snapshot({
      keywords: [kw('root', null, 'ルート'), kw('a', 'root', 'A', '2026-11-03T00:00:00Z'), kw('b', 'a', 'B'), kw('c', 'root', 'C')],
      questions: new Map([
        ['q1', sq('q1', { updatedAt: '2026-11-02T09:00:00.000+09:00' })],
        ['q2', sq('q2', { updatedAt: '2026-11-02T01:00:00.000Z' })],
      ]),
    });
    const d = computeImportDiff(
      file({
        basedOnExportedAt: '2026-11-02T00:30:00Z',
        keywords: { rename: [{ id: 'a', name: 'A2' }] },
        questions: { update: [update('q1', { stem: '新' })], disable: [{ id: 'q2', reason: null }] },
      }),
      snap,
    );
    expect(d.updated[0]?.updatedSinceExport).toBe(false); // 2026-11-02T00:00Z は出力前
    expect(d.warnings.map((w) => `${w.severity}:${w.code}@${w.path}`)).toEqual([
      'warning:updated_since_export@keywords.rename[0]',
      'warning:updated_since_export@questions.disable[0]',
    ]);
    expect(d.warnings[0]?.message).toContain('出力後に更新されています');

    const none = computeImportDiff(
      file({ questions: { update: [update('q1', { stem: '新' })] } }),
      snap,
    );
    expect(none.warnings).toEqual([]);
  });
});

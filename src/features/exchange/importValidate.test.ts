import { describe, expect, it } from 'vitest';
import type { Keyword } from '@/features/catalog/types';
import type { ImportFileV1 } from './format';
import { validateImport, type ImportSnapshot, type SnapshotQuestion } from './importValidate';

const kw = (id: string, parentId: string | null, name: string): Keyword & { updatedAt: string } => ({
  id,
  parentId,
  name,
  sortOrder: 0,
  subjectId: 's1',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

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
      ['qd', sq('qd', { status: 'deleted' })],
      ['qx', sq('qx', { status: 'disabled' })],
      ['qo', sq('qo', { subjectId: 's2' })],
    ]),
    openFlags: new Map(),
    ...over,
  };
}

type Ops = {
  keywords?: Partial<ImportFileV1['keywords']>;
  questions?: Partial<ImportFileV1['questions']>;
  subjectId?: string;
};

function file(ops: Ops = {}): ImportFileV1 {
  return {
    format: 'ai-question-study/import',
    version: 1,
    subjectId: ops.subjectId ?? 's1',
    basedOnExportedAt: null,
    keywords: { add: [], rename: [], move: [], ...ops.keywords },
    questions: { update: [], create: [], disable: [], ...ops.questions },
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  kind: 'feature' as const,
  stem: '問題文',
  explanation: '解説',
  keywords: [{ id: 'root' }],
  choices: choices(4).map(({ id: _id, ...c }) => c),
  ...over,
});

const update = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ...body({ choices: choices(4), ...over }),
});

const codes = (issues: { code: string; path: string; severity: string }[]) =>
  issues.map((i) => `${i.severity}:${i.code}@${i.path}`);

describe('validateImport', () => {
  it('正しいファイルは問題なし', () => {
    const f = file({
      keywords: {
        add: [{ tempKey: 'k1', parent: { id: 'root' }, name: '新規' }],
        rename: [{ id: 'a', name: 'A2' }],
        move: [{ id: 'c', parent: { tempKey: 'k1' } }],
      },
      questions: {
        update: [update('q1')],
        create: [{ tempKey: 'n1', ...body({ keywords: [{ tempKey: 'k1' }] }) }],
        disable: [{ id: 'q2', reason: null }],
      },
    });
    expect(validateImport(f, snapshot())).toEqual([]);
  });

  describe('参照（4.4、4.5、4.12）', () => {
    it('科目の不一致・不存在・削除済み', () => {
      expect(codes(validateImport(file({ subjectId: 'zz' }), snapshot()))).toEqual(['error:subject_mismatch@subjectId']);
      expect(codes(validateImport(file(), snapshot({ subject: null })))).toEqual(['error:subject_mismatch@subjectId']);
      const del = validateImport(file(), snapshot({ subject: { id: 's1', name: '科目', deleted: true } }));
      expect(del[0]?.message).toContain('削除');
    });

    it('存在しない・他科目のキーワード ID', () => {
      const f = file({
        keywords: {
          add: [{ tempKey: 'k1', parent: { id: 'nope' }, name: 'X' }],
          rename: [{ id: 'other', name: 'Y' }],
          move: [{ id: 'a', parent: { id: 'nope2' } }],
        },
        questions: { create: [body({ keywords: [{ id: 'other' }] })] },
      });
      const issues = validateImport(f, snapshot({ foreignKeywordIds: new Set(['other']) }));
      expect(codes(issues)).toEqual([
        'error:keyword_not_found@keywords.add[0].parent.id',
        'error:keyword_not_found@keywords.rename[0].id',
        'error:keyword_not_found@keywords.move[0].parent.id',
        'error:keyword_not_found@questions.create[0].keywords[0].id',
      ]);
      expect(issues[1]?.message).toContain('別の科目');
      // validateQuestion の foreign_keyword は重複して出さない
      expect(issues.some((i) => i.code === 'foreign_keyword')).toBe(false);
    });

    it('問題の不存在・他科目・削除済み', () => {
      const f = file({
        questions: {
          update: [update('missing'), update('qo'), update('qd')],
          disable: [{ id: 'qd2', reason: null }],
        },
      });
      const issues = validateImport(f, snapshot({ questions: new Map([...snapshot().questions, ['qd2', sq('qd2', { status: 'deleted' })]]) }));
      expect(codes(issues)).toEqual([
        'error:question_not_found@questions.update[0].id',
        'error:question_not_found@questions.update[1].id',
        'error:question_deleted@questions.update[2].id',
        'error:question_deleted@questions.disable[0].id',
      ]);
      expect(issues[1]?.message).toContain('別の科目');
    });

    it('他の問題の選択肢・存在しない選択肢 ID はエラー、id なしは新規として許可', () => {
      const cs = choices(4);
      const f = file({
        questions: {
          update: [
            update('q1', {
              choices: [cs[0], { ...cs[1], id: 'zz' }, { body: '新', explanation: 'e', isCorrect: false }, cs[3]],
            }),
          ],
        },
      });
      const snap = snapshot();
      snap.questions.set('q2', sq('q2', { choices: choices(4).map((c) => ({ ...c, id: `q2-${c.id}` })) }));
      expect(codes(validateImport(f, snap))).toEqual(['error:choice_not_in_question@questions.update[0].choices[1].id']);
    });
  });

  describe('構造（4.6〜4.9）', () => {
    it('自分の配下への移動は循環', () => {
      const f = file({ keywords: { move: [{ id: 'a', parent: { id: 'b' } }] } });
      expect(codes(validateImport(f, snapshot()))).toEqual(['error:keyword_cycle@keywords.move[0].parent']);
    });

    it('自分自身を親にする移動は循環', () => {
      const f = file({ keywords: { move: [{ id: 'a', parent: { id: 'a' } }] } });
      expect(codes(validateImport(f, snapshot()))).toEqual(['error:keyword_cycle@keywords.move[0].parent']);
    });

    it('新規キーワードを介する循環', () => {
      const f = file({
        keywords: {
          add: [{ tempKey: 'k1', parent: { id: 'b' }, name: 'K1' }],
          move: [{ id: 'a', parent: { tempKey: 'k1' } }],
        },
      });
      expect(codes(validateImport(f, snapshot()))).toEqual(['error:keyword_cycle@keywords.move[0].parent']);
    });

    it('新規どうしの循環', () => {
      const f = file({
        keywords: {
          add: [
            { tempKey: 'k1', parent: { tempKey: 'k2' }, name: 'K1' },
            { tempKey: 'k2', parent: { tempKey: 'k1' }, name: 'K2' },
          ],
        },
      });
      expect(codes(validateImport(f, snapshot()))).toEqual([
        'error:keyword_cycle@keywords.add[0].parent',
        'error:keyword_cycle@keywords.add[1].parent',
      ]);
    });

    it('別の枝への移動は循環にならない', () => {
      const f = file({ keywords: { move: [{ id: 'b', parent: { id: 'c' } }, { id: 'c', parent: null }] } });
      expect(validateImport(f, snapshot())).toEqual([]);
    });

    it('同じ親の下の名前の重複（追加・改名・移動、前後空白を無視）', () => {
      expect(
        codes(validateImport(file({ keywords: { add: [{ tempKey: 'k1', parent: { id: 'root' }, name: ' C ' }] } }), snapshot())),
      ).toEqual(['error:duplicate_sibling@keywords.add[0].name']);
      expect(codes(validateImport(file({ keywords: { rename: [{ id: 'a', name: 'C' }] } }), snapshot()))).toEqual([
        'error:duplicate_sibling@keywords.rename[0].name',
      ]);
      expect(codes(validateImport(file({ keywords: { move: [{ id: 'b', parent: { id: 'root' } }], rename: [{ id: 'b', name: 'A' }] } }), snapshot()))).toEqual([
        'error:duplicate_sibling@keywords.rename[0].name',
      ]);
      expect(codes(validateImport(file({ keywords: { move: [{ id: 'c', parent: { id: 'a' } }], rename: [{ id: 'c', name: 'B' }] } }), snapshot()))).toEqual([
        'error:duplicate_sibling@keywords.rename[0].name',
      ]);
      const kws = snapshot().keywords.concat(kw('d', 'a', 'C'));
      expect(codes(validateImport(file({ keywords: { move: [{ id: 'd', parent: { id: 'root' } }] } }), snapshot({ keywords: kws })))).toEqual([
        'error:duplicate_sibling@keywords.move[0].parent',
      ]);
    });

    it('改名で名前が入れ替わる場合は重複にならない', () => {
      const f = file({ keywords: { rename: [{ id: 'a', name: 'C' }, { id: 'c', name: 'A' }] } });
      expect(validateImport(f, snapshot())).toEqual([]);
    });

    it('一時キーの重複・未定義（キーワードと問題で名前空間が別）', () => {
      const f = file({
        keywords: {
          add: [
            { tempKey: 'k1', parent: null, name: 'X' },
            { tempKey: 'k1', parent: null, name: 'Y' },
          ],
          move: [{ id: 'a', parent: { tempKey: 'nokey' } }],
        },
        questions: {
          create: [
            { tempKey: 'k1', ...body() },
            { tempKey: 'n', ...body({ keywords: [{ tempKey: 'undef' }] }) },
            { tempKey: 'n', ...body() },
          ],
        },
      });
      expect(codes(validateImport(f, snapshot()))).toEqual([
        'error:temp_key_duplicate@keywords.add[1].tempKey',
        'error:temp_key_undefined@keywords.move[0].parent.tempKey',
        'error:temp_key_undefined@questions.create[1].keywords[0].tempKey',
        'error:temp_key_duplicate@questions.create[2].tempKey',
      ]);
    });

    it('同じ要素への複数の操作', () => {
      const f = file({
        keywords: {
          rename: [
            { id: 'a', name: 'X' },
            { id: 'a', name: 'Y' },
          ],
          move: [
            { id: 'c', parent: null },
            { id: 'c', parent: { id: 'a' } },
          ],
        },
        questions: { update: [update('q1')], disable: [{ id: 'q1', reason: '理由' }] },
      });
      expect(codes(validateImport(f, snapshot()))).toEqual([
        'error:duplicate_target@keywords.rename[1].id',
        'error:duplicate_target@keywords.move[1].id',
        'error:duplicate_target@questions.disable[0].id',
      ]);
    });

    it('改名と移動を1回ずつは許可', () => {
      const f = file({ keywords: { rename: [{ id: 'b', name: 'B2' }], move: [{ id: 'b', parent: { id: 'c' } }] } });
      expect(validateImport(f, snapshot())).toEqual([]);
    });
  });

  describe('作問ルール（4.10、4.13）', () => {
    it('validateQuestion のエラーと警告を位置付きで区別する', () => {
      const cs = choices(4);
      const f = file({
        questions: {
          update: [update('q1', { stem: ' ', choices: [cs[0], { ...cs[1], isCorrect: true }, cs[2]] })],
          create: [body({ stem: 'DNS とは', choices: [{ body: 'A', explanation: '', isCorrect: true }, { body: 'A', explanation: 'x', isCorrect: false }] })],
        },
      });
      const issues = validateImport(f, snapshot());
      expect(codes(issues)).toEqual([
        'error:correct_count@questions.update[0].choices',
        'error:required@questions.update[0].stem',
        'warning:choice_count_below@questions.update[0].choices',
        'error:required@questions.create[0].choices[0].explanation',
        'error:duplicate_choice@questions.create[0].choices[1].body',
        'warning:choice_count_below@questions.create[0].choices',
        'warning:abbreviation_unexplained@questions.create[0].stem',
      ]);
      expect(issues[0]?.message).toContain('正解の選択肢はちょうど1つ');
    });

    it('一時キーのキーワードは科目のキーワードとして扱い、紐づけなしはエラー', () => {
      const f = file({
        keywords: { add: [{ tempKey: 'k1', parent: null, name: 'X' }] },
        questions: { create: [body({ keywords: [{ tempKey: 'k1' }] }), body({ keywords: [] })] },
      });
      expect(codes(validateImport(f, snapshot()))).toEqual(['error:no_keyword@questions.create[1].keywords']);
    });

    it('無効の問題の修正は警告', () => {
      const issues = validateImport(file({ questions: { update: [update('qx')] } }), snapshot());
      expect(codes(issues)).toEqual(['warning:edit_disabled@questions.update[0]']);
      expect(issues[0]?.message).toContain('無効のまま');
    });
  });
});

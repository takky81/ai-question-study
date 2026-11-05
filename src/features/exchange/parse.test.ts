import { describe, expect, it } from 'vitest';
import { parseExportFile, parseImportFile } from './parse';

const validImport = {
  format: 'ai-question-study/import',
  version: 1,
  subjectId: 's1',
  basedOnExportedAt: '2026-11-01T00:00:00.000Z',
  keywords: {
    add: [{ tempKey: 'k1', parent: { id: 'kw-root' }, name: '新規' }],
    rename: [{ id: 'kw-a', name: '改名' }],
    move: [{ id: 'kw-b', parent: { tempKey: 'k1' } }],
  },
  questions: {
    update: [
      {
        id: 'q1',
        kind: 'keyword',
        stem: '問題文',
        explanation: '解説',
        keywords: [{ id: 'kw-a' }],
        choices: [
          { id: 'c1', body: 'A', explanation: '', isCorrect: true },
          { body: 'B', explanation: '', isCorrect: false },
        ],
      },
    ],
    create: [
      {
        tempKey: 'nq1',
        kind: 'feature',
        stem: '新規',
        explanation: '解説',
        keywords: [{ tempKey: 'k1' }],
        choices: [
          { body: 'A', explanation: '', isCorrect: true },
          { body: 'B', explanation: '', isCorrect: false },
        ],
      },
    ],
    disable: [{ id: 'q2', reason: '古い' }],
  },
};

const validExport = {
  format: 'ai-question-study/export',
  version: 1,
  exportedAt: '2026-11-01T00:00:00.000Z',
  subject: { id: 's1', name: '科目' },
  conditions: {
    keywordId: null,
    flag: 'types',
    flagTypes: ['guessable', 'comment'],
    correctRateMin: 0.2,
    correctRateMax: null,
    attemptMin: null,
    attemptMax: null,
    includeDisabled: false,
  },
  keywords: [
    {
      id: 'kw-a',
      parentId: null,
      name: 'A',
      sortOrder: 0,
      path: ['A'],
      stats: { questionCount: 1, attemptCount: 2, correctCount: 1, correctRate: 0.5 },
    },
  ],
  questions: [
    {
      id: 'q1',
      kind: 'keyword',
      stem: '問題文',
      explanation: '解説',
      keywordIds: ['kw-a'],
      status: 'disabled',
      disabledReason: '理由',
      updatedAt: '2026-11-01T00:00:00.000Z',
      choices: [{ id: 'c1', body: 'A', explanation: '', isCorrect: true }],
      openFlags: [{ flag: 'defective', note: null, createdAt: '2026-11-01T00:00:00.000Z' }],
      stats: { attemptCount: 2, correctCount: 1, correctRate: 0.5, retention: null },
    },
  ],
};

type Loose = Record<string, any>;
const clone = (v: unknown): Loose => JSON.parse(JSON.stringify(v)) as Loose;
const imp = (v: unknown) => parseImportFile(JSON.stringify(v));
const issuesOf = (r: ReturnType<typeof parseImportFile> | ReturnType<typeof parseExportFile>) =>
  r.ok ? [] : r.issues;
const codes = (r: ReturnType<typeof parseImportFile> | ReturnType<typeof parseExportFile>) =>
  issuesOf(r).map((i) => i.code);

describe('parseImportFile', () => {
  it('正しいファイルを型付きの値として返す', () => {
    expect(imp(validImport)).toEqual({ ok: true, value: validImport });
  });

  it('壊れた JSON は invalid_json だけを返す', () => {
    const r = parseImportFile('{ not json');
    expect(issuesOf(r)).toEqual([expect.objectContaining({ code: 'invalid_json', path: '' })]);
  });

  it('種類違いは wrong_format だけを返す', () => {
    expect(codes(imp({ ...validImport, format: 'ai-question-study/export', subjectId: 1 }))).toEqual([
      'wrong_format',
    ]);
  });

  it('対応外のバージョンは unsupported_version だけを返す', () => {
    const r = imp({ ...validImport, version: 2, subjectId: 1 });
    expect(codes(r)).toEqual(['unsupported_version']);
    expect(issuesOf(r)[0]?.path).toBe('version');
  });

  it('ルートがオブジェクトでなければ wrong_format', () => {
    expect(codes(parseImportFile('[]'))).toEqual(['wrong_format']);
  });

  it('省略された keywords・questions と配列を空に正規化し、reason の空白を null にする', () => {
    const r = imp({
      format: 'ai-question-study/import',
      version: 1,
      subjectId: 's1',
      questions: { disable: [{ id: 'q2', reason: '  ' }] },
    });
    expect(r).toEqual({
      ok: true,
      value: {
        format: 'ai-question-study/import',
        version: 1,
        subjectId: 's1',
        basedOnExportedAt: null,
        keywords: { add: [], rename: [], move: [] },
        questions: { update: [], create: [], disable: [{ id: 'q2', reason: null }] },
      },
    });
  });

  it('必須欠落・型違い・未知の操作・未知の項目を位置付きですべて返す', () => {
    const f = clone(validImport);
    delete f.subjectId;
    f.keywords.add[0].name = 5;
    delete f.questions.update[0].choices[1].body;
    f.questions.update[0].kind = 'other';
    f.questions.update[0].extra = 1;
    f.questions.create[0].choices[0].id = 'c9';
    f.questions.delete = [{ id: 'q3' }];
    f.keywords.move[0].parent = { foo: 'x' };
    const issues = issuesOf(imp(f));
    expect(issues.map((i) => [i.path, i.code])).toEqual(
      expect.arrayContaining([
        ['subjectId', 'missing_field'],
        ['keywords.add[0].name', 'invalid_type'],
        ['questions.update[0].choices[1].body', 'missing_field'],
        ['questions.update[0].kind', 'invalid_value'],
        ['questions.update[0].extra', 'unknown_field'],
        ['questions.create[0].choices[0].id', 'unknown_field'],
        ['questions.delete', 'unknown_field'],
        ['keywords.move[0].parent', 'invalid_value'],
      ]),
    );
    expect(issues).toHaveLength(8);
    for (const i of issues) expect(i.message).toMatch(/[ぁ-んァ-ン一-龥]/);
  });

  it('配列であるべき箇所が配列でなければ invalid_type', () => {
    const f = clone(validImport);
    f.questions.update = {};
    expect(issuesOf(imp(f)).map((i) => [i.path, i.code])).toEqual([['questions.update', 'invalid_type']]);
  });
});

describe('parseExportFile', () => {
  it('正しいファイルを型付きの値として返す', () => {
    expect(parseExportFile(JSON.stringify(validExport))).toEqual({ ok: true, value: validExport });
  });

  it('取込用ファイルは wrong_format', () => {
    expect(codes(parseExportFile(JSON.stringify(validImport)))).toEqual(['wrong_format']);
  });

  it('条件に attempted を含むファイルは未知の項目として返す', () => {
    const f = clone(validExport);
    (f.conditions as Loose).attempted = true;
    expect(issuesOf(parseExportFile(JSON.stringify(f))).map((i) => [i.path, i.code])).toEqual([
      ['conditions.attempted', 'unknown_field'],
    ]);
  });

  it('壊れた JSON・対応外バージョン', () => {
    expect(codes(parseExportFile(''))).toEqual(['invalid_json']);
    expect(codes(parseExportFile(JSON.stringify({ ...validExport, version: 0 })))).toEqual(['unsupported_version']);
  });

  it('フラグ識別子を QUESTION_FLAGS で検証し、構造の誤りを位置付きで返す', () => {
    const f = clone(validExport);
    f.conditions.flagTypes = ['guessable', 'bogus'];
    f.questions[0].openFlags[0].flag = 'nope';
    f.questions[0].status = 'deleted';
    f.keywords[0].path = 'A';
    delete f.questions[0].stats.retention;
    f.conditions.flag = 'xx';
    expect(issuesOf(parseExportFile(JSON.stringify(f))).map((i) => [i.path, i.code])).toEqual([
      ['conditions.flag', 'invalid_value'],
      ['conditions.flagTypes[1]', 'invalid_value'],
      ['keywords[0].path', 'invalid_type'],
      ['questions[0].status', 'invalid_value'],
      ['questions[0].openFlags[0].flag', 'invalid_value'],
      ['questions[0].stats.retention', 'missing_field'],
    ]);
  });
});

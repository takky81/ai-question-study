import { describe, expect, it } from 'vitest';
import { buildExportFile, exportFileName, type ExportRows } from './exportBuild';
import { defaultConditions, toSnapshot } from './conditions';
import { parseExportFile } from './parse';

const NOW = new Date(2026, 10, 3, 15, 30, 45); // ローカル時刻 2026-11-03 15:30:45
const conditions = toSnapshot(defaultConditions('s1'));
const CHANGED = '出力中にデータが変更されました。もう一度出力してください';

type QuestionRow = ExportRows['questions'][number];

function question(id: string, over: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id,
    kind: 'keyword',
    stem: `問題 ${id}`,
    explanation: `解説 ${id}`,
    disabledAt: null,
    disabledReason: null,
    createdAt: '2026-10-01T00:00:00+00:00',
    updatedAt: '2026-10-02T00:00:00+00:00',
    keywordIds: ['k-a'],
    attemptCount: 3,
    correctCount: 2,
    correctRate: 2 / 3,
    retention: 0.5,
    ...over,
  };
}

// 表示順と逆の行順で返す（position で並べ直すことを確かめる）
function choices(qid: string): ExportRows['choices'] {
  return [
    { questionId: qid, id: `${qid}-c2`, position: 2, body: 'B', explanation: '', isCorrect: false },
    { questionId: qid, id: `${qid}-c1`, position: 1, body: 'A', explanation: 'ea', isCorrect: true },
  ];
}

function baseRows(): ExportRows {
  return {
    subject: { id: 's1', name: '情報処理' },
    keywords: [
      { id: 'k-b', parentId: null, name: 'B', sortOrder: 2 },
      { id: 'k-a2', parentId: 'k-a', name: 'A2', sortOrder: 2 },
      { id: 'k-a', parentId: null, name: 'A', sortOrder: 1 },
      { id: 'k-a1', parentId: 'k-a', name: 'A1', sortOrder: 1 },
      { id: 'k-a1x', parentId: 'k-a1', name: 'A1x', sortOrder: 1 },
    ],
    keywordStats: [{ keywordId: 'k-a', questionCount: 2, attemptCount: 6, correctCount: 4, correctRate: 4 / 6 }],
    questions: [question('q1'), question('q2', { disabledAt: '2026-10-05T00:00:00+00:00', disabledReason: '古い' })],
    choices: [
      ...choices('q1'),
      ...choices('q2'),
      { questionId: 'orphan', id: 'x', position: 1, body: 'x', explanation: '', isCorrect: true },
    ],
    flags: [
      { id: 'f2', questionId: 'q1', flag: 'low_value', note: null, createdAt: '2026-10-03T10:00:00+09:00' },
      { id: 'f1', questionId: 'q1', flag: 'guessable', note: 'メモ', createdAt: '2026-10-03T00:00:00Z' },
      { id: 'f9', questionId: 'orphan', flag: 'guessable', note: null, createdAt: '2026-10-03T00:00:00Z' },
    ],
  };
}

describe('buildExportFile', () => {
  it('バージョン・出力日時・科目・条件を持ち、parseExportFile を通る', () => {
    const file = buildExportFile(baseRows(), conditions, NOW);
    expect(file.format).toBe('ai-question-study/export');
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe(NOW.toISOString());
    expect(file.subject).toEqual({ id: 's1', name: '情報処理' });
    expect(file.conditions).toEqual(conditions);
    expect(parseExportFile(JSON.stringify(file))).toEqual({ ok: true, value: file });
  });

  it('キーワードを深さ優先の順に並べ、階層パスと集計値（行がなければ 0・null）を付ける', () => {
    const file = buildExportFile(baseRows(), conditions, NOW);
    expect(file.keywords.map((k) => k.id)).toEqual(['k-a', 'k-a1', 'k-a1x', 'k-a2', 'k-b']);
    expect(file.keywords[2]).toMatchObject({ parentId: 'k-a1', name: 'A1x', sortOrder: 1, path: ['A', 'A1', 'A1x'] });
    expect(file.keywords[0]!.stats).toEqual({ questionCount: 2, attemptCount: 6, correctCount: 4, correctRate: 4 / 6 });
    expect(file.keywords[4]!.stats).toEqual({ questionCount: 0, attemptCount: 0, correctCount: 0, correctRate: null });
  });

  it('問題に選択肢（表示順）・未解消のフラグ（日時順）・集計値・状態を付け、孤立行を捨てる', () => {
    const file = buildExportFile(baseRows(), conditions, NOW);
    expect(file.questions).toHaveLength(2);
    expect(file.questions[0]).toEqual({
      id: 'q1',
      kind: 'keyword',
      stem: '問題 q1',
      explanation: '解説 q1',
      keywordIds: ['k-a'],
      status: 'active',
      disabledReason: null,
      updatedAt: '2026-10-02T00:00:00+00:00',
      choices: [
        { id: 'q1-c1', body: 'A', explanation: 'ea', isCorrect: true },
        { id: 'q1-c2', body: 'B', explanation: '', isCorrect: false },
      ],
      // f2 は 01:00Z、f1 は 00:00Z（文字列として比べると逆順になる）
      openFlags: [
        { flag: 'guessable', note: 'メモ', createdAt: '2026-10-03T00:00:00Z' },
        { flag: 'low_value', note: null, createdAt: '2026-10-03T10:00:00+09:00' },
      ],
      stats: { attemptCount: 3, correctCount: 2, correctRate: 2 / 3, retention: 0.5 },
    });
    expect(file.questions[1]).toMatchObject({ status: 'disabled', disabledReason: '古い', openFlags: [] });
  });

  it('問題0件でもキーワード階層だけのファイルを作れる', () => {
    const rows = { ...baseRows(), questions: [], choices: [], flags: [] };
    const file = buildExportFile(rows, conditions, NOW);
    expect(file.questions).toEqual([]);
    expect(file.keywords).toHaveLength(5);
    expect(parseExportFile(JSON.stringify(file)).ok).toBe(true);
  });

  it('2,500 問を欠落・重複なく組み立てる', () => {
    const rows = baseRows();
    rows.questions = Array.from({ length: 2500 }, (_, i) => question(`q${String(i).padStart(4, '0')}`));
    rows.choices = rows.questions.flatMap((q) => choices(q.id)).reverse();
    rows.flags = rows.questions.map((q, i) => ({
      id: `f${i}`,
      questionId: q.id,
      flag: 'guessable' as const,
      note: null,
      createdAt: '2026-10-03T00:00:00Z',
    }));
    const file = buildExportFile(rows, conditions, NOW);
    expect(file.questions.map((q) => q.id)).toEqual(rows.questions.map((q) => q.id));
    for (const q of file.questions) {
      expect(q.choices.map((c) => c.id)).toEqual([`${q.id}-c1`, `${q.id}-c2`]);
      expect(q.openFlags).toHaveLength(1);
    }
    expect(parseExportFile(JSON.stringify(file)).ok).toBe(true);
  });

  it('有効な選択肢が2個未満の問題があれば失敗する', () => {
    const rows = baseRows();
    rows.choices = rows.choices.filter((c) => c.id !== 'q2-c2');
    expect(() => buildExportFile(rows, conditions, NOW)).toThrow(CHANGED);
  });

  it('正解が1つでない問題があれば失敗する', () => {
    const none = baseRows();
    none.choices = none.choices.map((c) => (c.id === 'q1-c1' ? { ...c, isCorrect: false } : c));
    expect(() => buildExportFile(none, conditions, NOW)).toThrow(CHANGED);
    const two = baseRows();
    two.choices = two.choices.map((c) => (c.questionId === 'q1' ? { ...c, isCorrect: true } : c));
    expect(() => buildExportFile(two, conditions, NOW)).toThrow(CHANGED);
  });

  it('同じ問題・選択肢の行が重複していれば失敗する', () => {
    const dq = baseRows();
    dq.questions.push(question('q1'));
    expect(() => buildExportFile(dq, conditions, NOW)).toThrow(CHANGED);
    const dc = baseRows();
    dc.choices.push(dc.choices[0]!);
    expect(() => buildExportFile(dc, conditions, NOW)).toThrow(CHANGED);
  });
});

describe('exportFileName', () => {
  it('科目名と出力日時（ローカル時刻）を含む', () => {
    expect(exportFileName('情報処理', NOW)).toBe('export_情報処理_20261103-1530.json');
  });

  it('使えない文字と空白を _ に置き換える', () => {
    expect(exportFileName('a\\b/c:d*e?f"g<h>i|j k　l\tm', new Date(2026, 0, 5, 9, 7))).toBe(
      'export_a_b_c_d_e_f_g_h_i_j_k_l_m_20260105-0907.json',
    );
  });
});

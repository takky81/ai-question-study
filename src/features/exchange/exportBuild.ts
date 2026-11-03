// 出力 RPC の行から出力用ファイル（ExportFileV1）を組み立てる純粋関数と、ファイル名（1.9、2.1〜2.5、2.7、2.9、2.11）。
import type { QuestionKind } from '@/features/catalog/types';
import type { QuestionFlagId } from '@/features/quiz/flags';
import { buildKeywordTree, keywordPath, type KeywordNode, type KeywordTreeNode } from '@/lib/keywordTree';
import {
  EXCHANGE_FORMAT,
  EXCHANGE_VERSION,
  type ExportConditionsSnapshot,
  type ExportFileV1,
  type ExportKeyword,
  type ExportQuestion,
} from './format';

/** export_questions の行（api.ts で camelCase に変換済み）。 */
export type ExportQuestionRow = {
  id: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
  keywordIds: string[];
  attemptCount: number;
  correctCount: number;
  correctRate: number | null;
  retention: number | null;
};

/** export_choices の行。 */
export type ExportChoiceRow = {
  questionId: string;
  id: string;
  position: number;
  body: string;
  explanation: string;
  isCorrect: boolean;
};

/** export_flags の行（未解消のみ）。 */
export type ExportFlagRow = {
  id: string;
  questionId: string;
  flag: QuestionFlagId;
  note: string | null;
  createdAt: string;
};

export type ExportRows = {
  subject: { id: string; name: string };
  keywords: KeywordNode[];
  keywordStats: { keywordId: string; questionCount: number; attemptCount: number; correctCount: number; correctRate: number | null }[];
  questions: ExportQuestionRow[];
  choices: ExportChoiceRow[];
  flags: ExportFlagRow[];
};

const DATA_CHANGED_MESSAGE = '出力中にデータが変更されました。もう一度出力してください';

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 木を深さ優先（兄弟順）で平らにする。明示的なスタックで再帰の上限を避ける。
function flattenDepthFirst(roots: KeywordTreeNode[]): KeywordTreeNode[] {
  const result: KeywordTreeNode[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    result.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return result;
}

function buildKeywords(rows: ExportRows): ExportKeyword[] {
  const statsById = new Map(rows.keywordStats.map((s) => [s.keywordId, s]));
  return flattenDepthFirst(buildKeywordTree(rows.keywords)).map((k) => {
    const s = statsById.get(k.id);
    return {
      id: k.id,
      parentId: k.parentId,
      name: k.name,
      sortOrder: k.sortOrder,
      path: keywordPath(rows.keywords, k.id).map((n) => n.name),
      stats: {
        questionCount: s?.questionCount ?? 0,
        attemptCount: s?.attemptCount ?? 0,
        correctCount: s?.correctCount ?? 0,
        correctRate: s?.correctRate ?? null,
      },
    };
  });
}

function groupBy<T extends { questionId: string }>(rows: readonly T[], known: ReadonlySet<string>): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    if (!known.has(r.questionId)) continue; // 孤立行は捨てる
    const list = map.get(r.questionId);
    if (list) list.push(r);
    else map.set(r.questionId, [r]);
  }
  return map;
}

/**
 * 行から出力用ファイルを組み立てる。問題は行の順（RPC の created_at, id 順）を保つ。
 * 問題・選択肢の重複、有効な選択肢が2個未満、正解が1つでない問題があれば、取得中の変更とみなして失敗させる（2.9、2.10）。
 */
export function buildExportFile(rows: ExportRows, conditions: ExportConditionsSnapshot, now: Date): ExportFileV1 {
  const questionIds = new Set<string>();
  for (const q of rows.questions) {
    if (questionIds.has(q.id)) throw new Error(DATA_CHANGED_MESSAGE);
    questionIds.add(q.id);
  }
  const choiceIds = new Set<string>();
  for (const c of rows.choices) {
    if (!questionIds.has(c.questionId)) continue;
    if (choiceIds.has(c.id)) throw new Error(DATA_CHANGED_MESSAGE);
    choiceIds.add(c.id);
  }

  const choicesByQuestion = groupBy(rows.choices, questionIds);
  const flagsByQuestion = groupBy(rows.flags, questionIds);

  const questions: ExportQuestion[] = rows.questions.map((q) => {
    const choices = [...(choicesByQuestion.get(q.id) ?? [])].sort(
      (a, b) => a.position - b.position || compareIds(a.id, b.id),
    );
    if (choices.length < 2 || choices.filter((c) => c.isCorrect).length !== 1) {
      throw new Error(DATA_CHANGED_MESSAGE);
    }
    const flags = [...(flagsByQuestion.get(q.id) ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || compareIds(a.id, b.id),
    );
    return {
      id: q.id,
      kind: q.kind,
      stem: q.stem,
      explanation: q.explanation,
      keywordIds: [...q.keywordIds],
      status: q.disabledAt === null ? 'active' : 'disabled',
      disabledReason: q.disabledAt === null ? null : q.disabledReason,
      updatedAt: q.updatedAt,
      choices: choices.map((c) => ({ id: c.id, body: c.body, explanation: c.explanation, isCorrect: c.isCorrect })),
      openFlags: flags.map((f) => ({ flag: f.flag, note: f.note, createdAt: f.createdAt })),
      stats: {
        attemptCount: q.attemptCount,
        correctCount: q.correctCount,
        correctRate: q.correctRate,
        retention: q.retention,
      },
    };
  });

  return {
    format: EXCHANGE_FORMAT.export,
    version: EXCHANGE_VERSION,
    exportedAt: now.toISOString(),
    subject: { id: rows.subject.id, name: rows.subject.name },
    conditions: { ...conditions, flagTypes: [...conditions.flagTypes] },
    keywords: buildKeywords(rows),
    questions,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 例: export_情報処理_20261103-1530.json（日時はローカル時刻）。ファイル名に使えない文字と空白は _ にする（2.11）。 */
export function exportFileName(subjectName: string, now: Date): string {
  const safe = subjectName.replace(/[\\/:*?"<>|\s]/g, '_');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `export_${safe}_${stamp}.json`;
}

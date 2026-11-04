// 交換フォーマット（出力用・取込用 JSON）の型と定数。正本はこのファイル（3.1〜3.8）。
import type { QuestionKind } from '@/features/catalog/types';
import type { QuestionFlagId } from '@/features/quiz/flags';

export const EXCHANGE_FORMAT = {
  export: 'ai-question-study/export',
  import: 'ai-question-study/import',
} as const;
export const EXCHANGE_VERSION = 1;

/** 既存のキーワードは id、同じファイル内で追加するキーワードは tempKey で参照する（3.3、3.4）。 */
export type KeywordRef = { id: string } | { tempKey: string };

export type ExportConditionsSnapshot = {
  keywordId: string | null;
  flag: 'all' | 'any' | 'none' | 'types';
  flagTypes: QuestionFlagId[];
  correctRateMin: number | null; // 0〜1
  correctRateMax: number | null; // 0〜1
  attemptMin: number | null;
  attemptMax: number | null;
  attempted: boolean | null;
  includeDisabled: boolean;
};

export type ExportKeyword = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  path: string[]; // 根から自身までの名前
  stats: { questionCount: number; attemptCount: number; correctCount: number; correctRate: number | null };
};

/** 配列順が表示順。 */
export type ExportChoice = { id: string; body: string; explanation: string; isCorrect: boolean };
export type ExportFlag = { flag: QuestionFlagId; note: string | null; createdAt: string };

export type ExportQuestion = {
  id: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  keywordIds: string[];
  status: 'active' | 'disabled';
  disabledReason: string | null;
  updatedAt: string;
  choices: ExportChoice[];
  openFlags: ExportFlag[];
  stats: { attemptCount: number; correctCount: number; correctRate: number | null; retention: number | null };
};

export type ExportFileV1 = {
  format: typeof EXCHANGE_FORMAT.export;
  version: 1;
  exportedAt: string;
  subject: { id: string; name: string };
  conditions: ExportConditionsSnapshot;
  keywords: ExportKeyword[];
  questions: ExportQuestion[];
};

/** id 付きは既存の選択肢の更新、id なしは新規の選択肢（3.3、3.6）。 */
export type ImportChoice = { id?: string; body: string; explanation: string; isCorrect: boolean };
export type ImportQuestionBody = {
  kind: QuestionKind;
  stem: string;
  explanation: string;
  keywords: KeywordRef[];
  choices: ImportChoice[]; // 修正ではその問題の選択肢の全体（3.5）
};

/** 削除・有効化の操作は型に存在しない（3.7）。 */
export type ImportFileV1 = {
  format: typeof EXCHANGE_FORMAT.import;
  version: 1;
  subjectId: string;
  basedOnExportedAt: string | null;
  keywords: {
    add: { tempKey: string; parent: KeywordRef | null; name: string }[];
    rename: { id: string; name: string }[];
    move: { id: string; parent: KeywordRef | null }[];
  };
  questions: {
    update: (ImportQuestionBody & { id: string })[];
    create: (Omit<ImportQuestionBody, 'choices'> & { tempKey?: string; choices: Omit<ImportChoice, 'id'>[] })[];
    disable: { id: string; reason: string | null }[];
  };
};

// ---- 項目名の一覧（フォーマット文書との照合用、3.9） ----

type Elem<T> = T extends readonly (infer U)[] ? Elem<U> : T;
/** T に現れるすべてのプロパティ名（配列要素・入れ子・共用体の各分岐を含む）。 */
type DeepKeys<T> =
  Elem<T> extends infer U
    ? U extends object
      ? { [K in keyof U & string]-?: K | DeepKeys<U[K]> }[keyof U & string]
      : never
    : never;

/** 引数の配列が型の全プロパティ名をちょうど網羅していることを型で保証する。 */
const fieldNamesOf =
  <T>() =>
  <const A extends readonly DeepKeys<T>[]>(names: A & ([DeepKeys<T>] extends [A[number]] ? unknown : never)): A =>
    names;

export const IMPORT_FIELD_NAMES = fieldNamesOf<ImportFileV1>()([
  'format', 'version', 'subjectId', 'basedOnExportedAt',
  'keywords', 'add', 'rename', 'move', 'tempKey', 'parent', 'name', 'id',
  'questions', 'update', 'create', 'disable', 'reason',
  'kind', 'stem', 'explanation', 'choices', 'body', 'isCorrect',
]);

export const EXPORT_FIELD_NAMES = fieldNamesOf<ExportFileV1>()([
  'format', 'version', 'exportedAt', 'subject', 'id', 'name',
  'conditions', 'keywordId', 'flag', 'flagTypes', 'correctRateMin', 'correctRateMax',
  'attemptMin', 'attemptMax', 'attempted', 'includeDisabled',
  'keywords', 'parentId', 'sortOrder', 'path', 'stats', 'questionCount', 'attemptCount', 'correctCount', 'correctRate',
  'questions', 'kind', 'stem', 'explanation', 'keywordIds', 'status', 'disabledReason', 'updatedAt',
  'choices', 'body', 'isCorrect', 'openFlags', 'note', 'createdAt', 'retention',
]);

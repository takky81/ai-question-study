// 入出力の DB 呼び出し（出力の取得、取込スナップショットの取得、適用）、行変換、エラーの日本語化（1.1、1.8、2.5、2.9、2.10、4.4、6.7、7.3、7.4）。
import type { Keyword, QuestionKind } from '@/features/catalog/types';
import type { QuestionFlagId } from '@/features/quiz/flags';
import type { KeywordNode } from '@/lib/keywordTree';
import { fetchAllPages, type PageResult } from '../../lib/pagination';
import { supabase } from '../../lib/supabase';
import { toExportFilter, type ExportConditions } from './conditions';
import type { ImportDiff } from './diff';
import type { ExportChoiceRow, ExportFlagRow, ExportQuestionRow, ExportRows } from './exportBuild';
import type { ExportFlag, ImportFileV1, KeywordRef } from './format';
import type { ImportSnapshot, SnapshotQuestion } from './importValidate';
import type { ApplyPayload } from './plan';

type DbError = { code?: string; message: string };

export type ApplyResult = {
  keywordIds: Record<string, string>;
  questionIds: Record<string, string>;
  counts: ImportDiff['counts'];
  resolvedFlagCount: number;
};

/** 適用時に、プレビューの作成後にデータが変更されていた（7.3）。 */
export class StalePreviewError extends Error {
  constructor(message = STALE_MESSAGE) {
    super(message);
    this.name = 'StalePreviewError';
  }
}

const STALE_MESSAGE = 'プレビューの作成後にデータが変更されました。再検証してください';

// P0001 のエラーコードごとの文言。ここにないもの（keyword_not_found など）は汎用の文言にする
const P0001_MESSAGES: Record<string, string> = {
  stale_preview: STALE_MESSAGE,
  keyword_cycle: 'キーワードを自分自身または配下へは移動できません',
  one_correct_required: '正解は1つにしてください',
};

/** DB・RPC のエラーを画面表示用の日本語に変換する。未知のものは操作の文脈を付ける（6.7）。 */
export function toExchangeErrorMessage(context: string, error: DbError): string {
  if (error.code === '23505') return '同じ親の下に同じ名前のキーワードがあります';
  if (error.code === 'P0001') {
    const known = P0001_MESSAGES[error.message];
    if (known) return known;
  }
  return `${context}に失敗しました: ${error.message}`;
}

function throwIfError(context: string, error: DbError | null): void {
  if (error) throw new Error(toExchangeErrorMessage(context, error));
}

// ---- 行（snake_case）----
type KeywordRow = { id: string; subject_id: string; parent_id: string | null; name: string; sort_order: number };
type KeywordStatsRow = {
  keyword_id: string;
  question_count: number;
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
};
type ExportQuestionDbRow = {
  id: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  disabled_at: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
  keyword_ids: string[] | null;
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
  retention: number | null;
};
type ExportChoiceDbRow = {
  question_id: string;
  id: string;
  position: number;
  body: string;
  explanation: string;
  is_correct: boolean;
};
type ExportFlagDbRow = { id: string; question_id: string; flag: QuestionFlagId; note: string | null; created_at: string };

const KEYWORD_COLUMNS = 'id, subject_id, parent_id, name, sort_order';

const toKeyword = (r: KeywordRow): Keyword => ({
  id: r.id,
  subjectId: r.subject_id,
  parentId: r.parent_id,
  name: r.name,
  sortOrder: r.sort_order,
});

const toExportQuestion = (r: ExportQuestionDbRow): ExportQuestionRow => ({
  id: r.id,
  kind: r.kind,
  stem: r.stem,
  explanation: r.explanation,
  disabledAt: r.disabled_at,
  disabledReason: r.disabled_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  keywordIds: r.keyword_ids ?? [],
  attemptCount: r.attempt_count,
  correctCount: r.correct_count,
  correctRate: r.correct_rate,
  retention: r.retention,
});

const toExportChoice = (r: ExportChoiceDbRow): ExportChoiceRow => ({
  questionId: r.question_id,
  id: r.id,
  position: r.position,
  body: r.body,
  explanation: r.explanation,
  isCorrect: r.is_correct,
});

const toExportFlag = (r: ExportFlagDbRow): ExportFlagRow => ({
  id: r.id,
  questionId: r.question_id,
  flag: r.flag,
  note: r.note,
  createdAt: r.created_at,
});

// ---- 出力 ----

export async function listExportSubjects(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name')
    .is('deleted_at', null)
    .order('name')
    .order('id');
  throwIfError('科目の取得', error);
  return ((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
}

export async function listSubjectKeywords(subjectId: string): Promise<Keyword[]> {
  const rows = await fetchAllPages<KeywordRow>(
    (from, to) =>
      supabase
        .from('keywords')
        .select(KEYWORD_COLUMNS)
        .eq('subject_id', subjectId)
        .order('sort_order')
        .order('id')
        .range(from, to),
    'キーワードの取得',
  );
  return rows.map(toKeyword);
}

// keywordId は p_filter に含めず p_keyword_id で渡す
function exportArgs(c: ExportConditions) {
  return { p_subject_id: c.subjectId, p_keyword_id: c.keywordId ?? null, p_filter: toExportFilter(c) };
}

/** 条件に一致する問題の件数（行を返さない件数取得、1.8）。 */
export async function countExportQuestions(c: ExportConditions): Promise<number> {
  const { count, error } = await supabase.rpc('export_questions', exportArgs(c), { count: 'exact', head: true });
  throwIfError('件数の取得', error);
  return count ?? 0;
}

/**
 * 出力に必要な行を並列に共通ページングで取り切る。1つでも失敗すれば全体を失敗させる（2.9、2.10）。
 * ページングの順序は各 RPC の order by と一致させる。
 */
export async function fetchExportRows(c: ExportConditions): Promise<ExportRows> {
  const args = exportArgs(c);
  const pages = <T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, context: string) =>
    fetchAllPages<T>(page, context);

  const subjectPromise = (async () => {
    const { data, error } = await supabase
      .from('subjects')
      .select('id, name')
      .eq('id', c.subjectId)
      .is('deleted_at', null)
      .maybeSingle();
    throwIfError('科目の取得', error);
    if (!data) throw new Error('科目が見つかりません');
    const row = data as { id: string; name: string };
    return { id: row.id, name: row.name };
  })();

  const [subject, keywords, stats, questions, choices, flags] = await Promise.all([
    subjectPromise,
    pages<KeywordRow>(
      (from, to) =>
        supabase.from('keywords').select(KEYWORD_COLUMNS).eq('subject_id', c.subjectId).order('id').range(from, to),
      'キーワードの取得',
    ),
    pages<KeywordStatsRow>(
      (from, to) =>
        supabase
          .from('keyword_stats')
          .select('keyword_id, question_count, attempt_count, correct_count, correct_rate')
          .eq('subject_id', c.subjectId)
          .order('keyword_id')
          .range(from, to),
      'キーワードの集計の取得',
    ),
    pages<ExportQuestionDbRow>(
      (from, to) => supabase.rpc('export_questions', args).order('created_at').order('id').range(from, to),
      '問題の取得',
    ),
    pages<ExportChoiceDbRow>(
      (from, to) => supabase.rpc('export_choices', args).order('question_id').order('position').range(from, to),
      '選択肢の取得',
    ),
    pages<ExportFlagDbRow>(
      (from, to) =>
        supabase.rpc('export_flags', args).order('question_id').order('created_at').order('id').range(from, to),
      'フラグの取得',
    ),
  ]);

  return {
    subject,
    keywords: keywords.map(
      (r): KeywordNode => ({ id: r.id, parentId: r.parent_id, name: r.name, sortOrder: r.sort_order }),
    ),
    keywordStats: stats.map((r) => ({
      keywordId: r.keyword_id,
      questionCount: r.question_count,
      attemptCount: r.attempt_count,
      correctCount: r.correct_count,
      correctRate: r.correct_rate,
    })),
    questions: questions.map(toExportQuestion),
    choices: choices.map(toExportChoice),
    flags: flags.map(toExportFlag),
  };
}

// ---- 取込 ----

export const SNAPSHOT_CHUNK_SIZE = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type SnapshotQuestionRow = {
  id: string;
  subject_id: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  disabled_at: string | null;
  deleted_at: string | null;
  updated_at: string;
};
type SnapshotChoiceRow = {
  id: string;
  question_id: string;
  position: number;
  body: string;
  explanation: string;
  is_correct: boolean;
};
type LinkRow = { question_id: string; keyword_id: string };
type OpenFlagRow = { id: string; question_id: string; flag: QuestionFlagId; note: string | null; created_at: string };

function referencedKeywordIds(file: ImportFileV1): Set<string> {
  const ids = new Set<string>();
  const ref = (r: KeywordRef | null) => {
    if (r && 'id' in r) ids.add(r.id);
  };
  file.keywords.add.forEach((a) => ref(a.parent));
  file.keywords.rename.forEach((r) => ids.add(r.id));
  file.keywords.move.forEach((m) => {
    ids.add(m.id);
    ref(m.parent);
  });
  file.questions.update.forEach((q) => q.keywords.forEach(ref));
  file.questions.create.forEach((q) => q.keywords.forEach(ref));
  return ids;
}

async function loadQuestionChunk(ids: string[]) {
  const [questions, choices, links, flags] = await Promise.all([
    fetchAllPages<SnapshotQuestionRow>(
      (from, to) =>
        supabase
          .from('questions')
          .select('id, subject_id, kind, stem, explanation, disabled_at, deleted_at, updated_at')
          .in('id', ids)
          .order('id')
          .range(from, to),
      '問題の取得',
    ),
    fetchAllPages<SnapshotChoiceRow>(
      (from, to) =>
        supabase
          .from('choices')
          .select('id, question_id, position, body, explanation, is_correct')
          .in('question_id', ids)
          .is('removed_at', null)
          .order('question_id')
          .order('position')
          .order('id')
          .range(from, to),
      '選択肢の取得',
    ),
    fetchAllPages<LinkRow>(
      (from, to) =>
        supabase
          .from('question_keywords')
          .select('question_id, keyword_id')
          .in('question_id', ids)
          .order('question_id')
          .order('keyword_id')
          .range(from, to),
      '紐づけの取得',
    ),
    fetchAllPages<OpenFlagRow>(
      (from, to) =>
        supabase
          .from('question_flags')
          .select('id, question_id, flag, note, created_at')
          .in('question_id', ids)
          .eq('status', 'open')
          .order('question_id')
          .order('created_at')
          .order('id')
          .range(from, to),
      'フラグの取得',
    ),
  ]);
  return { questions, choices, links, flags };
}

/**
 * 取込の検証・差分に使う現在のデータを取得する（4.4、7.4）。
 * 参照された問題（修正・無効化）は削除済みを含めて 100 件ずつに分けて取得する。
 * updated_at は expected の比較に使うため文字列のまま渡す（Date に変換しない）。
 */
export async function loadImportSnapshot(file: ImportFileV1): Promise<ImportSnapshot> {
  const subjectId = file.subjectId;
  const validSubject = UUID_RE.test(subjectId);

  const subjectPromise = (async (): Promise<ImportSnapshot['subject']> => {
    if (!validSubject) return null;
    const { data, error } = await supabase
      .from('subjects')
      .select('id, name, deleted_at')
      .eq('id', subjectId)
      .maybeSingle();
    throwIfError('科目の取得', error);
    if (!data) return null;
    const row = data as { id: string; name: string; deleted_at: string | null };
    return { id: row.id, name: row.name, deleted: row.deleted_at !== null };
  })();

  const keywordsPromise = validSubject
    ? fetchAllPages<KeywordRow & { updated_at: string }>(
        (from, to) =>
          supabase
            .from('keywords')
            .select(`${KEYWORD_COLUMNS}, updated_at`)
            .eq('subject_id', subjectId)
            .order('id')
            .range(from, to),
        'キーワードの取得',
      )
    : Promise.resolve([]);

  const questionIds = [
    ...new Set([...file.questions.update.map((q) => q.id), ...file.questions.disable.map((q) => q.id)]),
  ].filter((id) => UUID_RE.test(id));
  const chunkPromise = Promise.all(chunks(questionIds, SNAPSHOT_CHUNK_SIZE).map(loadQuestionChunk));

  const [subject, keywordRows, chunkResults] = await Promise.all([subjectPromise, keywordsPromise, chunkPromise]);

  const keywords = keywordRows.map((r) => ({ ...toKeyword(r), updatedAt: r.updated_at }));
  const own = new Set(keywords.map((k) => k.id));
  const foreignKeywordIds = new Set([...referencedKeywordIds(file)].filter((id) => !own.has(id)));

  const questions = new Map<string, SnapshotQuestion>();
  const openFlags = new Map<string, ExportFlag[]>();
  for (const chunk of chunkResults) {
    const choicesByQ = new Map<string, SnapshotQuestion['choices']>();
    for (const c of chunk.choices) {
      const list = choicesByQ.get(c.question_id) ?? [];
      list.push({ id: c.id, body: c.body, explanation: c.explanation, isCorrect: c.is_correct });
      choicesByQ.set(c.question_id, list);
    }
    const linksByQ = new Map<string, string[]>();
    for (const l of chunk.links) {
      const list = linksByQ.get(l.question_id) ?? [];
      list.push(l.keyword_id);
      linksByQ.set(l.question_id, list);
    }
    for (const q of chunk.questions) {
      questions.set(q.id, {
        id: q.id,
        subjectId: q.subject_id,
        kind: q.kind,
        stem: q.stem,
        explanation: q.explanation,
        keywordIds: linksByQ.get(q.id) ?? [],
        choices: choicesByQ.get(q.id) ?? [],
        status: q.deleted_at !== null ? 'deleted' : q.disabled_at !== null ? 'disabled' : 'active',
        updatedAt: q.updated_at,
      });
    }
    for (const f of chunk.flags) {
      const list = openFlags.get(f.question_id) ?? [];
      list.push({ flag: f.flag, note: f.note, createdAt: f.created_at });
      openFlags.set(f.question_id, list);
    }
  }

  return { subject, keywords, foreignKeywordIds, questions, openFlags };
}

/** 取込を原子的に適用する。stale_preview は StalePreviewError にする（6.7、7.3）。 */
export async function applyImport(payload: ApplyPayload): Promise<ApplyResult> {
  const { data, error } = await supabase.rpc('apply_exchange_import', { p: payload });
  if (error) {
    if (error.code === 'P0001' && error.message === 'stale_preview') throw new StalePreviewError();
    throw new Error(toExchangeErrorMessage('取込の適用', error));
  }
  return data as ApplyResult;
}

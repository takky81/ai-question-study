// カタログの DB 呼び出し（科目・キーワード・問題）、行変換、エラーの日本語化。
import { supabase } from '../../lib/supabase';
import { fetchAllPages } from '../../lib/pagination';
import { toSearchArgs, type QuestionFilter } from './filters';
import type {
  Keyword,
  Question,
  QuestionInput,
  QuestionKind,
  QuestionListItem,
  Subject,
} from './types';

// 問題一覧の1ページの件数（7.4）
export const QUESTION_PAGE_SIZE = 50;

type DbError = { code?: string; message: string };

// DB の行（snake_case）
type SubjectRow = { id: string; name: string; created_at: string };
type KeywordRow = {
  id: string;
  subject_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
};
type KeywordDeletionImpactRow = {
  keyword_count: number;
  unlinked_question_count: number;
  disabled_question_count: number;
};

export type KeywordDeletionImpact = {
  keywordCount: number;
  unlinkedQuestionCount: number;
  disabledQuestionCount: number;
};

// RPC が P0001 で通知するエラーコード（例外メッセージ）ごとの文言
const P0001_MESSAGES: Record<string, string> = {
  keyword_cycle: 'キーワードを自分自身または配下へは移動できません',
  duplicate_sibling: '移動先に同じ名前のキーワードがすでにあります',
  keyword_subject_mismatch: '別の科目のキーワードは指定できません',
  keyword_not_found: 'キーワードが見つかりません',
  sibling_set_mismatch: 'キーワードの並びが最新ではありません。再読み込みしてください',
  subject_not_found: '科目が見つかりません',
  no_keyword: '紐づくキーワードがないため有効にできません',
  one_correct_required: '正解は1つにしてください',
  duplicate_choice_id: '選択肢の指定が重複しています',
  question_not_found: '問題が見つかりません',
  question_deleted: '削除済みの問題は変更できません',
  choice_not_in_question: 'この問題にない選択肢が指定されています',
};

// check 違反（23514）の制約名ごとの文言。該当しないもの（科目・キーワードの名前）は名前の文言にする
const CHECK_MESSAGES: Record<string, string> = {
  questions_stem_check: '問題文を入力してください',
  questions_kind_check: '問題の種別が正しくありません',
  choices_body_check: '選択肢の本文を入力してください',
};

function checkMessage(error: DbError): string {
  const hit = Object.entries(CHECK_MESSAGES).find(([c]) => error.message.includes(c));
  return hit ? hit[1] : '名前を入力してください';
}

// DB・RPC のエラーを画面表示用の日本語に変換する。未知のものは操作の文脈を付ける。
export function toCatalogErrorMessage(context: string, error: DbError): string {
  if (error.code === '23505') return '同じ名前がすでにあります';
  if (error.code === '23514') return checkMessage(error);
  if (error.code === 'P0001') {
    const known = P0001_MESSAGES[error.message];
    if (known) return known;
  }
  return `${context}に失敗しました: ${error.message}`;
}

// error があれば日本語の Error を投げる
function throwIfError(context: string, error: DbError | null): void {
  if (error) throw new Error(toCatalogErrorMessage(context, error));
}

function toSubject(row: SubjectRow): Subject {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function toKeyword(row: KeywordRow): Keyword {
  return {
    id: row.id,
    subjectId: row.subject_id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

// 複合型の戻り値は単一オブジェクトまたは1行の配列で届くため両方を受け付ける
function toKeywordDeletionImpact(
  data: KeywordDeletionImpactRow | KeywordDeletionImpactRow[] | null,
): KeywordDeletionImpact {
  const row = Array.isArray(data) ? data[0] : data;
  return {
    keywordCount: row?.keyword_count ?? 0,
    unlinkedQuestionCount: row?.unlinked_question_count ?? 0,
    disabledQuestionCount: row?.disabled_question_count ?? 0,
  };
}

type QuestionRow = {
  id: string;
  subject_id: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  disabled_at: string | null;
  disabled_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};
type ChoiceRow = { id: string; body: string; explanation: string; is_correct: boolean };
type QuestionListRow = {
  id: string;
  kind: QuestionKind;
  stem: string;
  created_at: string;
  disabled_at: string | null;
  keyword_ids: string[] | null;
};

function toQuestionListItem(row: QuestionListRow): QuestionListItem {
  return {
    id: row.id,
    kind: row.kind,
    stem: row.stem,
    status: row.disabled_at ? 'disabled' : 'active',
    keywordIds: row.keyword_ids ?? [],
    createdAt: row.created_at,
  };
}

function toQuestion(row: QuestionRow, choices: ChoiceRow[], keywordIds: string[]): Question {
  return {
    id: row.id,
    subjectId: row.subject_id,
    kind: row.kind,
    stem: row.stem,
    explanation: row.explanation,
    keywordIds,
    choices: choices.map((c) => ({
      id: c.id,
      body: c.body,
      explanation: c.explanation,
      isCorrect: c.is_correct,
    })),
    status: row.disabled_at ? 'disabled' : 'active',
    disabledReason: row.disabled_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUBJECT_COLUMNS = 'id, name, created_at';
const KEYWORD_COLUMNS = 'id, subject_id, parent_id, name, sort_order';
const QUESTION_COLUMNS =
  'id, subject_id, kind, stem, explanation, disabled_at, disabled_reason, deleted_at, created_at, updated_at';
const CHOICE_COLUMNS = 'id, body, explanation, is_correct, position';

// ============================================================
// 科目
// ============================================================

// 未削除の科目を名前順（同名なしだが念のため ID 順）で返す
export async function listSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select(SUBJECT_COLUMNS)
    .is('deleted_at', null)
    .order('name')
    .order('id');
  throwIfError('科目の取得', error);
  return ((data ?? []) as SubjectRow[]).map(toSubject);
}

export async function createSubject(name: string): Promise<Subject> {
  const { data, error } = await supabase
    .from('subjects')
    .insert({ name })
    .select(SUBJECT_COLUMNS)
    .single();
  throwIfError('科目の作成', error);
  return toSubject(data as SubjectRow);
}

export async function renameSubject(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('subjects').update({ name }).eq('id', id);
  throwIfError('科目の改名', error);
}

// 削除確認用に、科目配下のキーワード数と未削除の問題数を並列で数える
export async function countSubjectContents(
  id: string,
): Promise<{ keywordCount: number; questionCount: number }> {
  const [keywords, questions] = await Promise.all([
    supabase.from('keywords').select('id', { count: 'exact', head: true }).eq('subject_id', id),
    supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('subject_id', id)
      .is('deleted_at', null),
  ]);
  throwIfError('科目の件数の取得', keywords.error);
  throwIfError('科目の件数の取得', questions.error);
  return { keywordCount: keywords.count ?? 0, questionCount: questions.count ?? 0 };
}

export async function deleteSubject(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_subject', { p_subject_id: id });
  throwIfError('科目の削除', error);
}

// ============================================================
// キーワード
// ============================================================

// 科目のキーワードを全件取得する（1,000 件上限を ID 順のページングで越える）
export async function listKeywords(subjectId: string): Promise<Keyword[]> {
  const rows = await fetchAllPages<KeywordRow>(
    (from, to) =>
      supabase
        .from('keywords')
        .select(KEYWORD_COLUMNS)
        .eq('subject_id', subjectId)
        .order('id')
        .range(from, to),
    'キーワードの取得',
  );
  return rows.map(toKeyword);
}

// sort_order は送らず、DB のトリガーで兄弟の末尾に設定させる
export async function createKeyword(
  subjectId: string,
  parentId: string | null,
  name: string,
): Promise<Keyword> {
  const { data, error } = await supabase
    .from('keywords')
    .insert({ subject_id: subjectId, parent_id: parentId, name })
    .select(KEYWORD_COLUMNS)
    .single();
  throwIfError('キーワードの作成', error);
  return toKeyword(data as KeywordRow);
}

export async function renameKeyword(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('keywords').update({ name }).eq('id', id);
  throwIfError('キーワードの改名', error);
}

export async function moveKeyword(id: string, newParentId: string | null): Promise<void> {
  const { error } = await supabase.rpc('move_keyword', {
    p_keyword_id: id,
    p_new_parent_id: newParentId,
  });
  throwIfError('キーワードの移動', error);
}

export async function reorderKeywords(
  subjectId: string,
  parentId: string | null,
  orderedIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('reorder_keywords', {
    p_subject_id: subjectId,
    p_parent_id: parentId,
    p_ordered_ids: orderedIds,
  });
  throwIfError('キーワードの並べ替え', error);
}

export async function previewKeywordDeletion(id: string): Promise<KeywordDeletionImpact> {
  const { data, error } = await supabase.rpc('preview_keyword_deletion', { p_keyword_id: id });
  throwIfError('キーワードの削除影響の集計', error);
  return toKeywordDeletionImpact(data as KeywordDeletionImpactRow | null);
}

export async function deleteKeyword(id: string): Promise<KeywordDeletionImpact> {
  const { data, error } = await supabase.rpc('delete_keyword', { p_keyword_id: id });
  throwIfError('キーワードの削除', error);
  return toKeywordDeletionImpact(data as KeywordDeletionImpactRow | null);
}

// ============================================================
// 問題
// ============================================================

// 絞り込み条件で検索し、filter.page のページ（1ページ50件）と全体の件数を返す（7.1、7.4）
export async function searchQuestions(
  subjectId: string,
  filter: QuestionFilter,
): Promise<{ items: QuestionListItem[]; total: number }> {
  const from = (filter.page - 1) * QUESTION_PAGE_SIZE;
  const { data, error, count } = await supabase
    .rpc('search_questions', toSearchArgs(subjectId, filter), { count: 'exact' })
    .range(from, from + QUESTION_PAGE_SIZE - 1);
  throwIfError('問題の検索', error);
  return {
    items: ((data ?? []) as QuestionListRow[]).map(toQuestionListItem),
    total: count ?? 0,
  };
}

// 問題、有効な選択肢（表示順）、紐づけを並列で取得する。削除済み・存在しない問題は null
export async function getQuestion(id: string): Promise<Question | null> {
  const [question, choices, links] = await Promise.all([
    supabase.from('questions').select(QUESTION_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('choices')
      .select(CHOICE_COLUMNS)
      .eq('question_id', id)
      .is('removed_at', null)
      .order('position'),
    supabase.from('question_keywords').select('keyword_id').eq('question_id', id),
  ]);
  throwIfError('問題の取得', question.error);
  throwIfError('問題の取得', choices.error);
  throwIfError('問題の取得', links.error);
  const row = question.data as QuestionRow | null;
  if (!row || row.deleted_at) return null;
  return toQuestion(
    row,
    (choices.data ?? []) as ChoiceRow[],
    ((links.data ?? []) as { keyword_id: string }[]).map((l) => l.keyword_id),
  );
}

// 問題・選択肢・紐づけを1トランザクションで保存し、問題の ID を返す（4.6）
export async function saveQuestion(input: QuestionInput): Promise<string> {
  const { data, error } = await supabase.rpc('save_question', { p: input });
  throwIfError('問題の保存', error);
  return data as string;
}

// 無効化（理由は任意）と有効化（6.1、6.2）
export async function setQuestionDisabled(
  id: string,
  disabled: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_question_disabled', {
    p_question_id: id,
    p_disabled: disabled,
    p_reason: disabled ? (reason ?? null) : null,
  });
  throwIfError(disabled ? '問題の無効化' : '問題の有効化', error);
}

// 論理削除（行は残し deleted_at を設定する）（6.3）
export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('questions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  throwIfError('問題の削除', error);
}

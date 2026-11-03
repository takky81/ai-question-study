// カタログの DB 呼び出し（科目・キーワード）、行変換、エラーの日本語化。
import { supabase } from '../../lib/supabase';
import { fetchAllPages } from '../../lib/pagination';
import type { Keyword, Subject } from './types';

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
};

// DB・RPC のエラーを画面表示用の日本語に変換する。未知のものは操作の文脈を付ける。
export function toCatalogErrorMessage(context: string, error: DbError): string {
  if (error.code === '23505') return '同じ名前がすでにあります';
  if (error.code === '23514') return '名前を入力してください';
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

const SUBJECT_COLUMNS = 'id, name, created_at';
const KEYWORD_COLUMNS = 'id, subject_id, parent_id, name, sort_order';

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

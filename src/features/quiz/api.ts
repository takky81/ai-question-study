// 出題の DB 呼び出し（科目・キーワード・候補・問題・解答・フラグ）、行変換、エラーの日本語化。
import { supabase } from '../../lib/supabase';
import { fetchAllPages } from '../../lib/pagination';
import type { Keyword, QuestionKind, Subject } from '@/features/catalog/types';
import { CHECKBOX_FLAG_IDS, normalizeComment, type CheckboxFlagId } from './flags';
import type { QuizRange } from './range';
import type {
  AnswerKind,
  AnswerResult,
  QuestionStats,
  QuizCandidate,
  QuizChoice,
  QuizQuestion,
} from './types';

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
type StatsRow = {
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
  retention: number | null;
  last_answered_at: string | null;
};
type CandidateRow = StatsRow & { question_id: string; created_at: string };
type QuestionRow = {
  id: string;
  subject_id: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
};
type ChoiceRow = { id: string; body: string; explanation: string; is_correct: boolean };
type AnswerResultRow = StatsRow & {
  answer_id: string;
  is_correct: boolean;
  correct_choice_id: string;
  already_recorded: boolean;
};
type FlagRow = { flag: string; note: string | null };

// RPC が P0001 で通知するエラーコード（例外メッセージ）ごとの文言（3.3、7.6）
const P0001_MESSAGES: Record<string, string> = {
  question_not_servable: 'この問題は出題対象ではなくなりました',
  choice_not_in_question: '選択肢が見つかりません。問題を読み込み直してください',
};

// DB・RPC のエラーを画面表示用の日本語に変換する。未知のものは操作の文脈を付ける（10.5）。
export function toQuizErrorMessage(context: string, error: DbError): string {
  if (error.code === 'P0001') {
    const known = P0001_MESSAGES[error.message];
    if (known) return known;
  }
  return `${context}に失敗しました: ${error.message}`;
}

function throwIfError(context: string, error: DbError | null): void {
  if (error) throw new Error(toQuizErrorMessage(context, error));
}

function toStats(row: StatsRow | null): QuestionStats {
  return {
    attemptCount: row?.attempt_count ?? 0,
    correctCount: row?.correct_count ?? 0,
    correctRate: row?.correct_rate ?? null,
    retention: row?.retention ?? null,
    lastAnsweredAt: row?.last_answered_at ?? null,
  };
}

function toCandidate(row: CandidateRow): QuizCandidate {
  return { questionId: row.question_id, createdAt: row.created_at, ...toStats(row) };
}

function toChoice(row: ChoiceRow): QuizChoice {
  return { id: row.id, body: row.body, explanation: row.explanation, isCorrect: row.is_correct };
}

const KEYWORD_COLUMNS = 'id, subject_id, parent_id, name, sort_order';
const STATS_COLUMNS = 'attempt_count, correct_count, correct_rate, retention, last_answered_at';

// 未削除の科目を名前順で返す（1.1）
export async function listQuizSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, created_at')
    .is('deleted_at', null)
    .order('name')
    .order('id');
  throwIfError('科目の取得', error);
  return ((data ?? []) as SubjectRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
  }));
}

// 科目のキーワードを全件取得する（1.2、9.7）
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
  return rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    parentId: r.parent_id,
    name: r.name,
    sortOrder: r.sort_order,
  }));
}

// 範囲内の出題候補を全件取得する。部分木の展開は DB 側で行う（1.3、1.4、9.7）
export async function listQuizCandidates(range: QuizRange): Promise<QuizCandidate[]> {
  const rows = await fetchAllPages<CandidateRow>(
    (from, to) =>
      supabase
        .rpc('list_quiz_candidates', {
          p_subject_id: range.subjectId,
          p_keyword_id: range.keywordId,
        })
        .order('created_at')
        .order('question_id')
        .range(from, to),
    '出題候補の取得',
  );
  return rows.map(toCandidate);
}

// 出題対象・有効な選択肢（表示順）・紐づけ・成績を並列で取得する。出題対象外は null
export async function getQuizQuestion(id: string): Promise<QuizQuestion | null> {
  const [question, choices, links, stats] = await Promise.all([
    supabase
      .from('servable_questions')
      .select('id, subject_id, kind, stem, explanation')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('choices')
      .select('id, body, explanation, is_correct, position')
      .eq('question_id', id)
      .is('removed_at', null)
      .order('position'),
    supabase.from('question_keywords').select('keyword_id').eq('question_id', id),
    supabase.from('question_stats').select(STATS_COLUMNS).eq('question_id', id).maybeSingle(),
  ]);
  throwIfError('問題の取得', question.error);
  throwIfError('問題の取得', choices.error);
  throwIfError('問題の取得', links.error);
  throwIfError('問題の取得', stats.error);
  const row = question.data as QuestionRow | null;
  if (!row) return null;
  return {
    id: row.id,
    subjectId: row.subject_id,
    kind: row.kind,
    stem: row.stem,
    explanation: row.explanation,
    keywordIds: ((links.data ?? []) as { keyword_id: string }[]).map((l) => l.keyword_id),
    choices: ((choices.data ?? []) as ChoiceRow[]).map(toChoice),
    stats: toStats(stats.data as StatsRow | null),
  };
}

// 解答を記録する（冪等キー付き）（3.1、3.3、3.4）
export async function recordAnswer(input: {
  clientAnswerId: string;
  questionId: string;
  choiceId: string | null;
  kind: AnswerKind;
}): Promise<AnswerResult> {
  const { data, error } = await supabase.rpc('record_answer', {
    p_client_answer_id: input.clientAnswerId,
    p_question_id: input.questionId,
    p_choice_id: input.choiceId,
    p_kind: input.kind,
  });
  throwIfError('解答の記録', error);
  // 複合型の戻り値は単一オブジェクトまたは1行の配列で届くため両方を受け付ける
  const raw = data as AnswerResultRow | AnswerResultRow[] | null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row) throw new Error('解答の記録に失敗しました: 結果がありません');
  return {
    answerId: row.answer_id,
    isCorrect: row.is_correct,
    correctChoiceId: row.correct_choice_id,
    alreadyRecorded: row.already_recorded,
    ...toStats(row),
  };
}

// 未解消のチェック型フラグとコメントを返す（7.3）
export async function listOpenFlags(
  questionId: string,
): Promise<{ flags: CheckboxFlagId[]; comment: string | null }> {
  const { data, error } = await supabase
    .from('question_flags')
    .select('flag, note')
    .eq('question_id', questionId)
    .eq('status', 'open');
  throwIfError('フラグの取得', error);
  const rows = (data ?? []) as FlagRow[];
  const flags = rows
    .map((r) => r.flag)
    .filter((f): f is CheckboxFlagId => (CHECKBOX_FLAG_IDS as readonly string[]).includes(f));
  const comment = rows.find((r) => r.flag === 'comment')?.note ?? null;
  return { flags, comment };
}

// フラグを未解消として保存する。コメントは JS 側で正規化してから送る（7.2、7.5、7.6）
export async function saveQuestionFlags(
  questionId: string,
  flags: readonly CheckboxFlagId[],
  comment: string,
): Promise<void> {
  const { error } = await supabase.rpc('save_question_flags', {
    p_question_id: questionId,
    p_flags: [...flags],
    p_comment: normalizeComment(comment),
  });
  throwIfError('フラグの保存', error);
}

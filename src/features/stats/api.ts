// 学習統計の Supabase 呼び出し。DB 行（snake_case）とアプリ型の変換と日本語のエラーを担う（1.2、5.1、6.2、6.4、7.6）。
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/pagination';
import type { Keyword, Subject } from '@/features/catalog/types';
import { buildHistograms, type HistogramRow } from './bins';
import type { BinItem, StatsHistograms, StatsMetric, StatsTarget } from './types';

type DbError = { code?: string; message: string };

type SubjectRow = { id: string; name: string; created_at: string };
type KeywordRow = { id: string; subject_id: string; parent_id: string | null; name: string; sort_order: number };
type HistogramDbRow = { target: string; metric: string; bin: number; item_count: number };
type BinItemRow = {
  item_id: string;
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
  question_count: number | null;
  stem: string | null;
};

const METRIC_TO_DB: Record<StatsMetric, string> = { correctRate: 'correct_rate', attemptCount: 'attempt_count' };
const METRIC_FROM_DB: Record<string, StatsMetric> = { correct_rate: 'correctRate', attempt_count: 'attemptCount' };

// RPC が投げる既知の例外の日本語
const KNOWN_MESSAGES: Record<string, string> = {
  invalid_stats_target: '集計対象の指定が正しくありません',
  invalid_stats_metric: '指標の指定が正しくありません',
};

function describeError(error: { message: string }): string {
  return KNOWN_MESSAGES[error.message] ?? error.message;
}

// DB・RPC のエラーを操作の文脈付きの日本語にする（7.6）
export function toStatsErrorMessage(context: string, error: { message: string }): string {
  return `${context}に失敗しました: ${describeError(error)}`;
}

function throwIfError(context: string, error: DbError | null): void {
  if (error) throw new Error(toStatsErrorMessage(context, error));
}

// 未削除の科目を名前・ID 順で返す（1.2）
export async function listStatsSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, created_at')
    .is('deleted_at', null)
    .order('name')
    .order('id');
  throwIfError('科目の取得', error);
  return ((data ?? []) as SubjectRow[]).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

// 科目のキーワードを全件取得する
export async function listStatsKeywords(subjectId: string): Promise<Keyword[]> {
  const rows = await fetchAllPages<KeywordRow>(
    (from, to) =>
      supabase
        .from('keywords')
        .select('id, subject_id, parent_id, name, sort_order')
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

function toHistogramRow(row: HistogramDbRow): HistogramRow {
  const metric = METRIC_FROM_DB[row.metric];
  if (!metric || (row.target !== 'question' && row.target !== 'keyword')) {
    throw new Error(`ヒストグラムの取得に失敗しました: 想定外の行です（${row.target} / ${row.metric}）`);
  }
  return { target: row.target, metric, bin: row.bin, itemCount: row.item_count };
}

// 範囲内の設問・キーワードの区間ごとの件数を取得する（2.x、3.x、6.3）
export async function getHistograms(subjectId: string, keywordId: string | null): Promise<StatsHistograms> {
  const { data, error } = await supabase.rpc('stats_histograms', {
    p_subject_id: subjectId,
    p_keyword_id: keywordId,
  });
  throwIfError('ヒストグラムの取得', error);
  return buildHistograms(((data ?? []) as HistogramDbRow[]).map(toHistogramRow));
}

function toBinItem(row: BinItemRow): BinItem {
  return {
    itemId: row.item_id,
    attemptCount: row.attempt_count,
    correctCount: row.correct_count,
    correctRate: row.correct_rate ?? null,
    questionCount: row.question_count ?? null,
    stem: row.stem ?? null,
  };
}

// 区間内の設問・キーワードを item_id 順に全件取得する。途中で失敗したら部分結果を返さない（5.1、6.2、6.4）
export async function listBinItems(input: {
  subjectId: string;
  keywordId: string | null;
  target: StatsTarget;
  metric: StatsMetric;
  bin: number;
}): Promise<BinItem[]> {
  const rows = await fetchAllPages<BinItemRow>(async (from, to) => {
    const { data, error } = await supabase
      .rpc('stats_bin_items', {
        p_target: input.target,
        p_metric: METRIC_TO_DB[input.metric],
        p_bin: input.bin,
        p_subject_id: input.subjectId,
        p_keyword_id: input.keywordId,
      })
      .order('item_id')
      .range(from, to);
    return { data: data as BinItemRow[] | null, error: error ? { message: describeError(error) } : null };
  }, '区間の一覧の取得');
  return rows.map(toBinItem);
}

// 表示状態と URL 検索パラメータの相互変換（1.4、1.5、3.9、5.7）。不正値は既定値に戻す。
import type { StatsMetric, StatsTarget } from './types';

export type StatsView = {
  subjectId: string | null;
  keywordId: string | null; // null は科目全体
  target: StatsTarget; // 既定 'question'
  selected: { metric: StatsMetric; bin: number } | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^-?\d+$/;

function uuidOrNull(value: string | null): string | null {
  return value !== null && UUID_RE.test(value) ? value : null;
}

function isTarget(value: string | null): value is StatsTarget {
  return value === 'question' || value === 'keyword';
}

function isMetric(value: string | null): value is StatsMetric {
  return value === 'correctRate' || value === 'attemptCount';
}

export function parseStatsParams(params: URLSearchParams): StatsView {
  const target = params.get('target');
  const metric = params.get('metric');
  const bin = params.get('bin');
  const selected = isMetric(metric) && bin !== null && INT_RE.test(bin) ? { metric, bin: Number(bin) } : null;
  return {
    subjectId: uuidOrNull(params.get('subject')),
    keywordId: uuidOrNull(params.get('keyword')),
    target: isTarget(target) ? target : 'question',
    selected,
  };
}

// 既定値（null、'question'）は省く
export function toStatsParams(view: StatsView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.subjectId !== null) params.set('subject', view.subjectId);
  if (view.keywordId !== null) params.set('keyword', view.keywordId);
  if (view.target !== 'question') params.set('target', view.target);
  if (view.selected !== null) {
    params.set('metric', view.selected.metric);
    params.set('bin', String(view.selected.bin));
  }
  return params;
}

import type { ExportConditionsSnapshot } from './format';

/** 出力画面の条件。正答率は内部では 0〜1 で持ち、画面では percentToRate / rateToPercent で変換する。 */
export type ExportConditions = ExportConditionsSnapshot & { subjectId: string };

export type ConditionError = { field: string; message: string };

export function defaultConditions(subjectId: string): ExportConditions {
  return {
    subjectId,
    keywordId: null,
    flag: 'all',
    flagTypes: [],
    correctRateMin: null,
    correctRateMax: null,
    attemptMin: null,
    attemptMax: null,
    attempted: null,
    includeDisabled: false,
  };
}

/** 画面の 0〜100% を内部の 0〜1 に変換する。 */
export function percentToRate(percent: number | null): number | null {
  return percent === null ? null : percent / 100;
}

/** 内部の 0〜1 を画面の 0〜100% に変換する（浮動小数の誤差を丸める）。 */
export function rateToPercent(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100 * 1e6) / 1e6;
}

const isValidRate = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
const isValidCount = (v: number) => Number.isInteger(v) && v >= 0;

/** 条件のエラーを欄ごとに返す（1.10）。空配列なら出力できる。 */
export function validateConditions(c: ExportConditions): ConditionError[] {
  const errors: ConditionError[] = [];
  const range = (
    minField: 'correctRateMin' | 'attemptMin',
    maxField: 'correctRateMax' | 'attemptMax',
    valid: (v: number) => boolean,
    invalidMessage: string,
    label: string,
  ) => {
    const min = c[minField];
    const max = c[maxField];
    let ok = true;
    if (min !== null && !valid(min)) {
      errors.push({ field: minField, message: invalidMessage });
      ok = false;
    }
    if (max !== null && !valid(max)) {
      errors.push({ field: maxField, message: invalidMessage });
      ok = false;
    }
    if (ok && min !== null && max !== null && min > max) {
      errors.push({ field: minField, message: `${label}の下限が上限を超えています` });
    }
  };
  range('correctRateMin', 'correctRateMax', isValidRate, '正答率は 0〜100% で指定してください', '正答率');
  range('attemptMin', 'attemptMax', isValidCount, '出題数は 0 以上の整数で指定してください', '出題数');
  if (c.flag === 'types' && c.flagTypes.length === 0) {
    errors.push({ field: 'flagTypes', message: 'フラグの種類を1つ以上選んでください' });
  }
  return errors;
}

/** 出力 RPC の p_filter に変換する（キーは export_target_ids が読む名前と一致させる）。 */
export function toExportFilter(c: ExportConditions): Record<string, unknown> {
  return {
    flag: c.flag,
    flagTypes: c.flag === 'types' ? [...c.flagTypes] : [],
    correctRateMin: c.correctRateMin,
    correctRateMax: c.correctRateMax,
    attemptMin: c.attemptMin,
    attemptMax: c.attemptMax,
    attempted: c.attempted,
    includeDisabled: c.includeDisabled,
  };
}

/** 出力ファイルに記録する条件（subjectId を除く）。 */
export function toSnapshot(c: ExportConditions): ExportConditionsSnapshot {
  const { subjectId: _subjectId, ...snapshot } = c;
  return { ...snapshot, flagTypes: [...snapshot.flagTypes] };
}

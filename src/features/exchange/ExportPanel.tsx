import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';

import { QUESTION_FLAGS, type QuestionFlagId } from '@/features/quiz/flags';
import type { Keyword } from '@/features/catalog/types';

import { countExportQuestions, fetchExportRows, listExportSubjects, listSubjectKeywords } from './api';
import { defaultConditions, percentToRate, toSnapshot, validateConditions, type ExportConditions } from './conditions';
import { buildExportFile, exportFileName } from './exportBuild';
import { KeywordScopePicker } from './KeywordScopePicker';

type Props = {
  /** 件数取得の遅延（ミリ秒、1.8）。テストでは 0 を渡す */
  countDelayMs?: number;
};

type Subject = { id: string; name: string };
type NumField = 'correctRateMin' | 'correctRateMax' | 'attemptMin' | 'attemptMax';
type Count = { state: 'idle' } | { state: 'loading' } | { state: 'done'; value: number } | { state: 'error'; message: string };

const FLAG_OPTIONS: { value: ExportConditions['flag']; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'any', label: '未解消のフラグがある' },
  { value: 'none', label: '未解消のフラグがない' },
  { value: 'types', label: '種類を指定' },
];
const ATTEMPTED_OPTIONS: { value: '' | 'false' | 'true'; label: string }[] = [
  { value: '', label: '指定しない' },
  { value: 'false', label: '未出題のみ' },
  { value: 'true', label: '出題済みのみ' },
];
const NUM_FIELDS: { field: NumField; label: string; percent: boolean }[] = [
  { field: 'correctRateMin', label: '正答率の下限（%）', percent: true },
  { field: 'correctRateMax', label: '正答率の上限（%）', percent: true },
  { field: 'attemptMin', label: '出題数の下限', percent: false },
  { field: 'attemptMax', label: '出題数の上限', percent: false },
];
const EMPTY_NUMS: Record<NumField, string> = { correctRateMin: '', correctRateMax: '', attemptMin: '', attemptMax: '' };

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const parseNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));

function download(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 出力パネル。科目・範囲・条件を指定し、件数を確かめて交換用 JSON をダウンロードする
 * （1.1、1.2、1.5、1.6、1.8、1.9、1.10、2.1、2.7、2.10、10.2、10.4）。
 */
export function ExportPanel({ countDelayMs = 300 }: Props): ReactElement {
  const id = useId();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const [base, setBase] = useState<ExportConditions>(() => defaultConditions(''));
  const [nums, setNums] = useState(EMPTY_NUMS);
  const [count, setCount] = useState<Count>({ state: 'idle' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadSubjects = useCallback(() => {
    setSubjectsError(null);
    setSubjects(null);
    listExportSubjects().then(setSubjects, (e: unknown) => setSubjectsError(errorMessage(e, '科目の取得に失敗しました')));
  }, []);
  useEffect(loadSubjects, [loadSubjects]);

  // 科目ごとのキーワード（古い応答は捨てる）
  const [keywordsReload, setKeywordsReload] = useState(0);
  useEffect(() => {
    if (!subjectId) return;
    let active = true;
    setKeywords(null);
    setKeywordsError(null);
    listSubjectKeywords(subjectId).then(
      (k) => active && setKeywords(k),
      (e: unknown) => active && setKeywordsError(errorMessage(e, 'キーワードの取得に失敗しました')),
    );
    return () => {
      active = false;
    };
  }, [subjectId, keywordsReload]);

  const conditions: ExportConditions = useMemo(
    () => ({
      ...base,
      subjectId,
      correctRateMin: percentToRate(parseNum(nums.correctRateMin)),
      correctRateMax: percentToRate(parseNum(nums.correctRateMax)),
      attemptMin: parseNum(nums.attemptMin),
      attemptMax: parseNum(nums.attemptMax),
    }),
    [base, subjectId, nums],
  );
  const errors = useMemo(() => validateConditions(conditions), [conditions]);
  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;
  const conditionsKey = JSON.stringify(conditions);

  // 条件が変わるたびに遅延付きで件数を取る。最新の要求以外の応答は捨てる（1.8）
  const [countReload, setCountReload] = useState(0);
  useEffect(() => {
    if (!subjectId || errors.length > 0) {
      setCount({ state: 'idle' });
      return;
    }
    let active = true;
    setCount({ state: 'loading' });
    const c = JSON.parse(conditionsKey) as ExportConditions;
    const timer = setTimeout(() => {
      countExportQuestions(c).then(
        (value) => active && setCount({ state: 'done', value }),
        (e: unknown) => active && setCount({ state: 'error', message: errorMessage(e, '件数の取得に失敗しました') }),
      );
    }, countDelayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [conditionsKey, subjectId, errors.length, countDelayMs, countReload]);

  const exportSeq = useRef(0);
  const runExport = async () => {
    const subject = subjects?.find((s) => s.id === subjectId);
    if (!subject || errors.length > 0 || exporting) return;
    const seq = ++exportSeq.current;
    setExporting(true);
    setExportError(null);
    try {
      const rows = await fetchExportRows(conditions);
      const now = new Date();
      const file = buildExportFile(rows, toSnapshot(conditions), now);
      if (seq !== exportSeq.current) return;
      download(JSON.stringify(file, null, 2), exportFileName(rows.subject.name || subject.name, now));
    } catch (e) {
      if (seq === exportSeq.current) setExportError(errorMessage(e, '出力に失敗しました'));
    } finally {
      if (seq === exportSeq.current) setExporting(false);
    }
  };

  const changeSubject = (next: string) => {
    setSubjectId(next);
    setBase((b) => ({ ...b, keywordId: null }));
    setExportError(null);
  };
  const toggleType = (flag: QuestionFlagId, on: boolean) =>
    setBase((b) => ({ ...b, flagTypes: on ? [...b.flagTypes, flag] : b.flagTypes.filter((f) => f !== flag) }));

  const fieldError = (field: string) => {
    const msg = errorFor(field);
    return msg ? (
      <p id={`${id}-${field}-err`} className="text-sm text-incorrect">
        {msg}
      </p>
    ) : null;
  };
  const inputClass = 'tap-target focus-ring w-full min-w-0 rounded border border-border bg-surface px-2';
  const disabled = exporting;

  if (subjectsError) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded border border-warn p-3">
        <p>{subjectsError}</p>
        <button type="button" onClick={loadSubjects} className="tap-target focus-ring self-start rounded border border-border px-4">
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 break-words">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-subject`} className="font-bold">
          科目
        </label>
        <select
          id={`${id}-subject`}
          value={subjectId}
          disabled={subjects === null || disabled}
          onChange={(e) => changeSubject(e.target.value)}
          className={inputClass}
        >
          <option value="">{subjects === null ? '読み込み中…' : '科目を選んでください'}</option>
          {subjects?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {subjects?.length === 0 && <p className="text-sm text-text-muted">科目がありません</p>}
      </div>

      {subjectId && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
            <fieldset className="flex min-w-0 flex-col gap-1">
              <legend className="font-bold">フラグ条件</legend>
              {FLAG_OPTIONS.map((o) => (
                <label key={o.value} className="tap-target flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-flag`}
                    className="focus-ring"
                    checked={base.flag === o.value}
                    onChange={() => setBase((b) => ({ ...b, flag: o.value }))}
                  />
                  {o.label}
                </label>
              ))}
              {base.flag === 'types' && (
                <div className="flex min-w-0 flex-col gap-1 pl-6">
                  {QUESTION_FLAGS.map((f) => (
                    <label key={f.id} className="tap-target flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        className="focus-ring"
                        checked={base.flagTypes.includes(f.id)}
                        onChange={(e) => toggleType(f.id, e.target.checked)}
                      />
                      {f.label}
                    </label>
                  ))}
                  {fieldError('flagTypes')}
                </div>
              )}
            </fieldset>

            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="font-bold">統計条件</legend>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                {NUM_FIELDS.map((f) => (
                  <div key={f.field} className="flex min-w-0 flex-col gap-1">
                    <label htmlFor={`${id}-${f.field}`} className="text-sm">
                      {f.label}
                    </label>
                    <input
                      id={`${id}-${f.field}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={f.percent ? 100 : undefined}
                      value={nums[f.field]}
                      aria-invalid={errorFor(f.field) ? true : undefined}
                      aria-describedby={errorFor(f.field) ? `${id}-${f.field}-err` : undefined}
                      onChange={(e) => setNums((n) => ({ ...n, [f.field]: e.target.value }))}
                      className={inputClass}
                    />
                    {fieldError(f.field)}
                  </div>
                ))}
              </div>
              <label htmlFor={`${id}-attempted`} className="text-sm">
                出題の有無
              </label>
              <select
                id={`${id}-attempted`}
                value={base.attempted === null ? '' : String(base.attempted)}
                onChange={(e) =>
                  setBase((b) => ({ ...b, attempted: e.target.value === '' ? null : e.target.value === 'true' }))
                }
                className={inputClass}
              >
                {ATTEMPTED_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </fieldset>

            <label className="tap-target flex items-center gap-2">
              <input
                type="checkbox"
                className="focus-ring"
                checked={base.includeDisabled}
                onChange={(e) => setBase((b) => ({ ...b, includeDisabled: e.target.checked }))}
              />
              無効化された問題を含める
            </label>
          </fieldset>

          <div className="flex min-w-0 flex-col gap-4">
            <div aria-live="polite" className="min-w-0">
              {count.state === 'loading' && <p className="text-text-muted">件数を確認しています…</p>}
              {count.state === 'done' && count.value > 0 && <p className="font-bold">{count.value} 問が一致します</p>}
              {count.state === 'done' && count.value === 0 && (
                <p>条件に一致する問題はありません。キーワード階層だけを出力できます</p>
              )}
              {count.state === 'error' && (
                <div className="flex flex-col gap-2">
                  <p className="text-warn">{count.message}</p>
                  <button
                    type="button"
                    onClick={() => setCountReload((n) => n + 1)}
                    className="tap-target focus-ring self-start rounded border border-border px-4"
                  >
                    件数を再取得
                  </button>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-bold">範囲</span>
              {keywordsError ? (
                <div className="flex flex-col gap-2">
                  <p className="text-warn">{keywordsError}</p>
                  <button
                    type="button"
                    onClick={() => setKeywordsReload((n) => n + 1)}
                    className="tap-target focus-ring self-start rounded border border-border px-4"
                  >
                    キーワードを再取得
                  </button>
                </div>
              ) : keywords === null ? (
                <p className="text-text-muted">読み込み中…</p>
              ) : (
                <KeywordScopePicker
                  keywords={keywords}
                  value={base.keywordId}
                  onChange={(keywordId) => setBase((b) => ({ ...b, keywordId }))}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {exportError && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-warn p-3">
          <p>{exportError}</p>
          <button
            type="button"
            onClick={() => void runExport()}
            className="tap-target focus-ring self-start rounded border border-border px-4"
          >
            再試行
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={!subjectId || errors.length > 0 || exporting || keywords === null}
        aria-busy={exporting}
        onClick={() => void runExport()}
        className="tap-target focus-ring self-start rounded border border-primary bg-primary px-6 font-bold text-bg disabled:opacity-50"
      >
        {exporting ? '出力中…' : '出力'}
      </button>
    </div>
  );
}

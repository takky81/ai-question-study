// 取込パネル: ファイル選択 → フォーマット検証 → スナップショット取得 → 参照・作問ルールの検証 → 差分 → 警告確認 → 適用 → 結果
// （4.1、4.11、5.9、5.10、6.6、6.7、6.8、7.3、7.4）
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { applyImport, loadImportSnapshot, StalePreviewError, type ApplyResult } from './api';
import { computeImportDiff, type ImportDiff } from './diff';
import { DiffPreview } from './DiffPreview';
import type { ImportPanelSlotProps } from './ExchangePage';
import type { ImportFileV1 } from './format';
import { validateImport, type ImportIssue, type ImportSnapshot } from './importValidate';
import { IssueList } from './IssueList';
import { parseImportFile, type FormatIssue } from './parse';
import { buildApplyPayload } from './plan';

type Phase =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'invalid'; issues: FormatIssue[] }
  | { state: 'loadError'; message: string }
  | { state: 'validated'; snapshot: ImportSnapshot; issues: ImportIssue[]; diff: ImportDiff | null };

type ApplyError = { message: string; stale: boolean };

const COUNT_LABELS: [keyof ImportDiff['counts'], string][] = [
  ['keywordsAdded', 'キーワードの追加'],
  ['keywordsRenamed', 'キーワードの改名'],
  ['keywordsMoved', 'キーワードの移動'],
  ['questionsUpdated', '問題の修正'],
  ['questionsCreated', '問題の新規作成'],
  ['questionsDisabled', '問題の無効化'],
];

const totalChanges = (diff: ImportDiff) => Object.values(diff.counts).reduce((a, b) => a + b, 0);
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : '不明なエラーが発生しました');

export function ImportPanel({ onHoldingChange }: ImportPanelSlotProps): ReactElement {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [file, setFile] = useState<ImportFileV1 | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: 'idle' });
  const [acknowledged, setAcknowledged] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<ApplyError | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  // 古い読み込み・検証の結果を捨てるための世代番号と、二重適用を防ぐ同期的なガード（6.8）
  const generation = useRef(0);
  const applyingRef = useRef(false);

  // ファイルかプレビューを保持している間は離脱を確認させる（10.6）
  const holding = fileName !== null;
  useEffect(() => onHoldingChange(holding), [holding, onHoldingChange]);

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  /** 同じファイルを現在のデータで検証し直す（4.1、7.4）。 */
  const validate = useCallback(async (target: ImportFileV1) => {
    const gen = ++generation.current;
    setPhase({ state: 'checking' });
    setAcknowledged(false);
    setApplyError(null);
    try {
      const snapshot = await loadImportSnapshot(target);
      if (gen !== generation.current) return;
      const issues = validateImport(target, snapshot);
      const hasError = issues.some((i) => i.severity === 'error');
      const diff = hasError ? null : computeImportDiff(target, snapshot);
      setPhase({ state: 'validated', snapshot, issues: diff ? [...issues, ...diff.warnings] : issues, diff });
    } catch (e) {
      if (gen !== generation.current) return;
      setPhase({ state: 'loadError', message: errorMessage(e) });
    }
  }, []);

  const onFileChange = async (selected: File | undefined) => {
    if (!selected) return;
    const gen = ++generation.current;
    setResult(null);
    setApplyError(null);
    setAcknowledged(false);
    setFile(null);
    setFileName(selected.name);
    setPhase({ state: 'checking' });
    let text: string;
    try {
      text = await selected.text();
    } catch (e) {
      if (gen !== generation.current) return;
      setPhase({ state: 'loadError', message: `ファイルの読み込みに失敗しました: ${errorMessage(e)}` });
      return;
    }
    if (gen !== generation.current) return;
    const parsed = parseImportFile(text);
    if (!parsed.ok) {
      setPhase({ state: 'invalid', issues: parsed.issues });
      return;
    }
    setFile(parsed.value);
    await validate(parsed.value);
  };

  const discard = () => {
    generation.current++;
    setFile(null);
    setFileName(null);
    setPhase({ state: 'idle' });
    setAcknowledged(false);
    setApplyError(null);
    resetInput();
  };

  const validated = phase.state === 'validated' ? phase : null;
  const diff = validated?.diff ?? null;
  const hasErrors = validated?.issues.some((i) => i.severity === 'error') ?? false;
  const hasWarnings = validated?.issues.some((i) => i.severity === 'warning') ?? false;
  const noChanges = diff !== null && totalChanges(diff) === 0;
  const applicable = !!file && !!diff && !hasErrors && !noChanges;
  const canApply = applicable && (!hasWarnings || acknowledged) && !applying;

  const apply = async () => {
    if (applyingRef.current || !canApply || !file || !validated || !diff) return;
    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await applyImport(buildApplyPayload(file, validated.snapshot, diff));
      generation.current++;
      setResult(res);
      setFile(null);
      setFileName(null);
      setPhase({ state: 'idle' });
      setAcknowledged(false);
      resetInput();
    } catch (e) {
      setApplyError({ message: errorMessage(e), stale: e instanceof StalePreviewError });
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 break-words">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-file`} className="font-bold">
          取込ファイル
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={`${id}-file`}
            type="file"
            accept="application/json,.json"
            disabled={applying}
            onChange={(e) => void onFileChange(e.target.files?.[0])}
            className="tap-target focus-ring min-w-0 max-w-full rounded border border-border px-2"
          />
          {holding && (
            <button
              type="button"
              onClick={discard}
              disabled={applying}
              className="tap-target focus-ring rounded border border-border px-4"
            >
              ファイルを外す
            </button>
          )}
        </div>
        <p className="text-sm text-text-muted">ファイルを選ぶと、適用せずに検証と差分の確認を行います。</p>
      </div>

      {result && (
        <section role="status" aria-label="適用の結果" className="flex min-w-0 flex-col gap-1 rounded border border-border p-3">
          <p className="font-bold">取込を適用しました</p>
          <ul className="grid min-w-0 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {COUNT_LABELS.map(([key, label]) => (
              <li key={key}>
                {label}: {result.counts[key]}件
              </li>
            ))}
            <li>解消したフラグ: {result.resolvedFlagCount}件</li>
          </ul>
        </section>
      )}

      <div aria-live="polite" className="min-w-0">
        {phase.state === 'checking' && <p className="text-text-muted">検証しています…</p>}
      </div>

      {phase.state === 'invalid' && (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-bold">ファイルの形式に問題があるため、検証とプレビューを行いません。</p>
          <IssueList issues={phase.issues} />
        </div>
      )}

      {phase.state === 'loadError' && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-warn p-3">
          <p className="text-warn">{phase.message}</p>
          {file && (
            <button
              type="button"
              onClick={() => void validate(file)}
              className="tap-target focus-ring self-start rounded border border-border px-4"
            >
              再試行
            </button>
          )}
        </div>
      )}

      {validated && (
        <div className="flex min-w-0 flex-col gap-4">
          <IssueList issues={validated.issues} />
          {hasErrors && <p className="font-bold">エラーがあるため適用できません。ファイルを直して選び直してください。</p>}
          {diff && <DiffPreview diff={diff} keywords={validated.snapshot.keywords} />}
          {noChanges && <p className="font-bold">適用する変更はありません</p>}

          {applyError && (
            <div role="alert" className="flex flex-col gap-2 rounded border border-warn p-3">
              <p className="text-warn">{applyError.message}</p>
              {applyError.stale ? null : <p className="text-sm">取込ファイルとプレビューは保持しています。</p>}
              <button
                type="button"
                onClick={() => file && void validate(file)}
                className="tap-target focus-ring self-start rounded border border-border px-4"
              >
                再検証
              </button>
            </div>
          )}

          {applicable && (
            <div className="flex min-w-0 flex-col gap-2">
              {hasWarnings && (
                <label className="tap-target flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={applying}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="focus-ring"
                  />
                  警告を確認しました
                </label>
              )}
              <button
                type="button"
                onClick={() => void apply()}
                disabled={!canApply}
                className="tap-target focus-ring self-start rounded border border-primary bg-primary px-6 font-bold text-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applying ? '適用中…' : '適用する'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

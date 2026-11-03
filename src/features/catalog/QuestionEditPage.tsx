// 問題の作成・編集画面: 入力ごとの検証、欄ごとのエラー表示、警告の確認後保存、保存中の無効化、
// 失敗時の入力保持、見つからない場合の導線、未保存変更の破棄確認（4.4、4.6、4.7、4.8、5.8、5.9、9.6）。
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';

import { getQuestion, listKeywords, saveQuestion } from './api';
import { ChoiceEditor } from './ChoiceEditor';
import { ConfirmDialog } from './ConfirmDialog';
import { createDraft, fromQuestion, isDirty } from './draft';
import { KeywordPicker } from './KeywordPicker';
import type { Keyword, QuestionInput, QuestionKind } from './types';
import { validateQuestion, type ValidationIssue, type ValidationTarget } from './validate';

const KIND_OPTIONS: { value: QuestionKind; label: string }[] = [
  { value: 'keyword', label: 'キーワードを答える問題' },
  { value: 'feature', label: '特徴などを答える問題' },
];

const FIELD = 'focus-ring min-w-0 rounded border border-border bg-bg p-2 text-text';
const BUTTON = 'tap-target focus-ring rounded border px-4 font-bold disabled:opacity-50';

type Loaded = { original: QuestionInput; draft: QuestionInput; keywords: Keyword[] };
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'notFound' }
  | ({ status: 'ready' } & Loaded);

function targetKey(t: ValidationTarget): string {
  return 'index' in t ? `${t.field}-${t.index}` : t.field;
}

function isBlankChoices(d: QuestionInput): boolean {
  return d.choices.every((c) => c.body === '' && c.explanation === '' && !c.isCorrect);
}

// URL の ID が UUID でなければ DB へ問い合わせず「見つかりません」にする（22P02 を避ける）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function QuestionEditPage(): ReactElement {
  const { subjectId = '', questionId } = useParams();
  const navigate = useNavigate();
  const baseId = useId();
  const listPath = `/catalog/${subjectId}`;

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempted, setAttempted] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 保存成功直後の遷移（新規 → 編集 URL）では破棄確認を出さない
  const skipBlock = useRef(false);
  // 同じ描画内の連打でも二重保存しない（4.8）
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!UUID.test(subjectId) || (questionId !== undefined && !UUID.test(questionId))) {
      setLoad({ status: 'notFound' });
      return;
    }
    setLoad({ status: 'loading' });
    (async () => {
      try {
        const [keywords, q] = await Promise.all([
          listKeywords(subjectId),
          questionId ? getQuestion(questionId) : Promise.resolve(null),
        ]);
        if (!alive) return;
        if (questionId && (!q || q.subjectId !== subjectId)) {
          setLoad({ status: 'notFound' });
          return;
        }
        const original = q ? fromQuestion(q) : createDraft(subjectId, 'keyword');
        setLoad({ status: 'ready', original, draft: original, keywords });
      } catch (e) {
        if (alive) setLoad({ status: 'error', message: errorMessage(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [subjectId, questionId, reloadKey]);

  const ready = load.status === 'ready' ? load : null;
  const dirty = ready ? isDirty(ready.original, ready.draft) : false;

  useEffect(() => {
    if (!dirty) skipBlock.current = false;
  }, [dirty]);

  const issues: ValidationIssue[] = useMemo(() => {
    if (!ready) return [];
    return validateQuestion(ready.draft, { subjectKeywordIds: new Set(ready.keywords.map((k) => k.id)) });
  }, [ready]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  // 画面内の遷移（9.6）
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        dirty && !skipBlock.current && currentLocation.pathname !== nextLocation.pathname,
      [dirty],
    ),
  );

  // ブラウザの離脱（9.6）
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (load.status === 'loading') return <p>読み込み中…</p>;
  if (load.status === 'notFound') {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">問題が見つかりません</h1>
        <p>削除されたか、存在しない問題です。</p>
        <Link to={listPath} className="tap-target focus-ring self-start underline">
          問題一覧へ戻る
        </Link>
      </section>
    );
  }
  if (load.status === 'error') {
    return (
      <section className="flex flex-col gap-3">
        <p role="alert" className="break-words text-warn">
          {load.message}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BUTTON} border-border`} onClick={() => setReloadKey((k) => k + 1)}>
            再試行
          </button>
          <Link to={listPath} className="tap-target focus-ring underline">
            問題一覧へ戻る
          </Link>
        </div>
      </section>
    );
  }

  const { draft, keywords, original } = load;

  function setDraft(next: QuestionInput) {
    setLoad((s) => (s.status === 'ready' ? { ...s, draft: next } : s));
    setConfirmWarnings(false);
  }

  function changeKind(kind: QuestionKind) {
    // 新規で選択肢が未入力なら、種別の原則数の空欄に作り直す（4.4）
    if (draft.id === null && isBlankChoices(draft)) {
      setDraft({ ...draft, kind, choices: createDraft(subjectId, kind).choices });
    } else {
      setDraft({ ...draft, kind });
    }
  }

  // 保存ボタン押下後に、検証結果を欄の近くへ表示し aria-describedby で結び付ける（5.8）
  const shown = attempted ? issues : [];
  const byTarget = new Map<string, ValidationIssue[]>();
  for (const i of shown) {
    const k = targetKey(i.target);
    byTarget.set(k, [...(byTarget.get(k) ?? []), i]);
  }
  const msgId = (t: ValidationTarget) => (byTarget.has(targetKey(t)) ? `${baseId}-${targetKey(t)}` : undefined);
  const hasError = (t: ValidationTarget) => byTarget.get(targetKey(t))?.some((i) => i.severity === 'error') || undefined;
  const messages = (t: ValidationTarget) => {
    const list = byTarget.get(targetKey(t));
    if (!list) return null;
    return (
      <ul id={msgId(t)} className="text-sm break-words">
        {list.map((i, n) => (
          <li key={n} className={i.severity === 'error' ? 'text-warn' : 'text-text-muted'}>
            {i.severity === 'error' ? 'エラー: ' : '警告: '}
            {i.message}
          </li>
        ))}
      </ul>
    );
  };
  // 選択肢まわりのメッセージは選択肢欄の直後にまとめて表示する
  const choiceTargets = [
    ...new Map(
      shown
        .map((i) => i.target)
        .filter((t) => t.field === 'choices' || t.field === 'choiceBody' || t.field === 'choiceExplanation')
        .map((t) => [targetKey(t), t] as const),
    ).values(),
  ];

  async function doSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const id = await saveQuestion(draft);
      const saved = { ...draft, id };
      skipBlock.current = true;
      setLoad((s) => (s.status === 'ready' ? { ...s, original: saved, draft: saved } : s));
      setAttempted(false);
      setConfirmWarnings(false);
      if (draft.id === null) navigate(`/catalog/${subjectId}/questions/${id}`, { replace: true });
    } catch (e) {
      // 入力は保持したまま再試行できる（4.7）
      setSaveError(errorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function onSave() {
    if (saving || savingRef.current) return; // 4.8
    setAttempted(true);
    if (errors.length > 0) return; // 5.8
    if (warnings.length > 0 && !confirmWarnings) {
      setConfirmWarnings(true); // 5.9
      return;
    }
    void doSave();
  }

  return (
    <section className="flex max-w-4xl min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{draft.id ? '問題の編集' : '新しい問題'}</h1>
        <Link to={listPath} className="tap-target focus-ring ml-auto underline">
          問題一覧へ戻る
        </Link>
      </div>

      <fieldset className="flex flex-wrap gap-3">
        <legend className="font-bold">種別</legend>
        {KIND_OPTIONS.map((o) => (
          <label key={o.value} className="tap-target flex items-center gap-2">
            <input
              type="radio"
              name={`${baseId}-kind`}
              className="focus-ring h-5 w-5"
              checked={draft.kind === o.value}
              onChange={() => changeKind(o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      <label className="flex min-w-0 flex-col gap-1">
        <span className="font-bold">問題文</span>
        <textarea
          className={FIELD}
          rows={3}
          value={draft.stem}
          onChange={(e) => setDraft({ ...draft, stem: e.target.value })}
          aria-describedby={msgId({ field: 'stem' })}
          aria-invalid={hasError({ field: 'stem' })}
        />
      </label>
      {messages({ field: 'stem' })}

      <label className="flex min-w-0 flex-col gap-1">
        <span className="font-bold">問題の解説</span>
        <textarea
          className={FIELD}
          rows={3}
          value={draft.explanation}
          onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
          aria-describedby={msgId({ field: 'explanation' })}
          aria-invalid={hasError({ field: 'explanation' })}
        />
      </label>
      {messages({ field: 'explanation' })}

      <KeywordPicker
        keywords={keywords}
        selectedIds={draft.keywordIds}
        onChange={(ids) => setDraft({ ...draft, keywordIds: ids })}
        describedBy={msgId({ field: 'keywords' })}
      />
      {messages({ field: 'keywords' })}

      <ChoiceEditor draft={draft} onChange={setDraft} describedBy={msgId} />
      {choiceTargets.map((t) => (
        <div key={targetKey(t)}>{messages(t)}</div>
      ))}

      {attempted && errors.length > 0 && (
        <p className="font-bold text-warn">エラーが {errors.length} 件あります。修正してから保存してください。</p>
      )}
      {confirmWarnings && errors.length === 0 && (
        <div className="flex flex-col gap-2 rounded border border-border p-3">
          <p className="font-bold">警告があります。内容を確認してください。</p>
          <ul className="list-disc pl-5 break-words">
            {warnings.map((w, n) => (
              <li key={n}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
      {saveError && (
        <p role="alert" className="break-words text-warn">
          {saveError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${BUTTON} border-primary bg-primary text-bg`}
          disabled={saving}
          onClick={onSave}
        >
          {saving ? '保存中…' : confirmWarnings && errors.length === 0 ? '警告を確認して保存' : '保存'}
        </button>
        {!dirty && original.id && <span className="self-center text-text-muted">保存済み</span>}
      </div>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="変更を破棄しますか"
        message="保存していない変更を破棄して移動します。"
        confirmLabel="破棄して移動"
        danger
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </section>
  );
}

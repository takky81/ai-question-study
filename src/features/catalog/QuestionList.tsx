import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { keywordPath } from '../../lib/keywordTree';
import { ConfirmDialog } from './ConfirmDialog';
import {
  QUESTION_PAGE_SIZE,
  deleteQuestion,
  listKeywords,
  searchQuestions,
  setQuestionDisabled,
} from './api';
import { parseFilter, toSearchParams, type QuestionFilter } from './filters';
import { QuestionFilters } from './QuestionFilters';
import type { Keyword, QuestionKind, QuestionListItem } from './types';

const STEM_LENGTH = 80;
const KIND_LABEL: Record<QuestionKind, string> = { keyword: 'キーワード問題', feature: '特徴問題' };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function stemHead(stem: string): string {
  const chars = Array.from(stem);
  return chars.length > STEM_LENGTH ? `${chars.slice(0, STEM_LENGTH).join('')}…` : stem;
}

type Props = { subjectId: string };

type Pending =
  | { type: 'disable'; question: QuestionListItem; reason: string }
  | { type: 'delete'; question: QuestionListItem };

/**
 * 科目の問題一覧（7.1〜7.7、8.5）と行からの編集・無効化・有効化・削除（6.1〜6.3、6.6）。
 * 絞り込み条件とページは URL に保持し、編集画面から戻っても同じ一覧を表示する（7.3）。
 */
export function QuestionList({ subjectId }: Props): ReactElement {
  const headingId = useId();
  const reasonId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  // 編集画面から同じ条件の一覧へ戻れるよう、現在の条件を遷移の状態で渡す（7.3）
  const linkState = { listSearch: useLocation().search };
  const filter = useMemo(() => parseFilter(searchParams), [searchParams]);
  // 描画を待たずに続く変更でも直前の変更を土台にする（関数形式の setSearchParams は描画時の値を渡すため）
  const latestParams = useRef(searchParams);
  useEffect(() => {
    latestParams.current = searchParams;
  }, [searchParams]);

  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [result, setResult] = useState<{ items: QuestionListItem[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const reload = useCallback(async () => {
    try {
      const [found, kws] = await Promise.all([searchQuestions(subjectId, filter), listKeywords(subjectId)]);
      setResult(found);
      setKeywords(kws);
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, [subjectId, filter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pathOf = useCallback(
    (id: string) =>
      keywordPath(keywords, id)
        .map((k) => k.name)
        .join(' / '),
    [keywords],
  );

  // 連続した変更が上書きし合わないよう、最新の URL の条件へ差分を重ねる
  function updateFilter(patch: Partial<QuestionFilter>) {
    const next = toSearchParams({ ...parseFilter(latestParams.current), ...patch });
    latestParams.current = next;
    setSearchParams(next);
  }

  function onFilterChange(patch: Partial<QuestionFilter>) {
    setError(null);
    updateFilter({ ...patch, page: 1 });
  }

  // 処理中の二重実行を防ぎ、失敗は日本語のエラーとして表示する
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // 操作の成功後に一覧を更新する。2ページ目以降の唯一の行が消えうる場合は、
  // 範囲外のページを要求しないよう前のページへ移る（移動で再取得される）
  async function refreshAfterChange() {
    if ((result?.items.length ?? 0) <= 1 && filter.page > 1) {
      updateFilter({ page: filter.page - 1 });
    } else {
      await reload();
    }
  }

  async function onEnable(q: QuestionListItem) {
    await run(async () => {
      await setQuestionDisabled(q.id, false);
      await refreshAfterChange();
    });
  }

  async function onConfirm() {
    if (!pending) return;
    const target = pending;
    const ok = await run(async () => {
      if (target.type === 'disable') {
        const reason = target.reason.trim();
        await setQuestionDisabled(target.question.id, true, reason === '' ? undefined : reason);
      } else {
        await deleteQuestion(target.question.id);
      }
      await refreshAfterChange();
    });
    if (ok) setPending(null);
  }

  const total = result?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / QUESTION_PAGE_SIZE));
  const items = result?.items ?? [];
  const keywordLabel = filter.keywordId ? pathOf(filter.keywordId) || null : null;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-bold">
          問題
        </h2>
        <Link
          to={`/catalog/${subjectId}/questions/new`}
          state={linkState}
          className="tap-target focus-ring flex items-center rounded border border-primary bg-primary px-4 font-bold text-bg"
        >
          問題を作成
        </Link>
      </div>

      <QuestionFilters filter={filter} keywordLabel={keywordLabel} onChange={onFilterChange} />

      {error && !pending && (
        <p role="alert" className="break-words text-warn">
          {error}
        </p>
      )}

      {loadError ? (
        <div role="alert" className="flex min-w-0 flex-wrap items-center gap-2 text-warn">
          <span className="min-w-0 break-words">{loadError}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="tap-target focus-ring rounded border border-warn px-3"
          >
            再試行
          </button>
          {filter.page > 1 && (
            <button
              type="button"
              onClick={() => updateFilter({ page: 1 })}
              className="tap-target focus-ring rounded border border-border px-3 text-text"
            >
              最初のページへ
            </button>
          )}
        </div>
      ) : result === null ? (
        <p className="text-text-muted">読み込み中…</p>
      ) : (
        <>
          <p aria-live="polite">{total} 件</p>
          {items.length === 0 ? (
            <p className="text-text-muted">条件に一致する問題はありません</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {items.map((q) => {
                const head = stemHead(q.stem);
                return (
                  <li
                    key={q.id}
                    className="flex min-w-0 flex-col gap-2 rounded border border-border bg-surface p-2 lg:flex-row lg:items-center"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="min-w-0 break-words">{head}</p>
                      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm">
                        <span>{KIND_LABEL[q.kind]}</span>
                        <span className={q.status === 'disabled' ? 'font-bold text-text-muted' : ''}>
                          {q.status === 'disabled' ? '無効' : '有効'}
                        </span>
                      </div>
                      {q.keywordIds.length > 0 && (
                        <ul aria-label="紐づくキーワード" className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-text-muted">
                          {q.keywordIds.map((kid) => (
                            <li key={kid} className="min-w-0 break-words">
                              {pathOf(kid) || '（不明なキーワード）'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/catalog/${subjectId}/questions/${q.id}`}
                        state={linkState}
                        aria-label={`「${head}」を編集`}
                        className="tap-target focus-ring flex items-center rounded border border-border px-3"
                      >
                        編集
                      </Link>
                      {q.status === 'active' ? (
                        <button
                          type="button"
                          aria-label={`「${head}」を無効化`}
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setPending({ type: 'disable', question: q, reason: '' });
                          }}
                          className="tap-target focus-ring rounded border border-border px-3 disabled:opacity-50"
                        >
                          無効化
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`「${head}」を有効に戻す`}
                          disabled={busy}
                          onClick={() => void onEnable(q)}
                          className="tap-target focus-ring rounded border border-border px-3 disabled:opacity-50"
                        >
                          有効に戻す
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`「${head}」を削除`}
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setPending({ type: 'delete', question: q });
                        }}
                        className="tap-target focus-ring rounded border border-warn px-3 text-warn disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <nav aria-label="ページ送り" className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={filter.page <= 1}
              onClick={() => updateFilter({ page: filter.page - 1 })}
              className="tap-target focus-ring rounded border border-border px-3 disabled:opacity-50"
            >
              前へ
            </button>
            <span>
              {filter.page} / {pageCount} ページ
            </span>
            <button
              type="button"
              disabled={filter.page >= pageCount}
              onClick={() => updateFilter({ page: filter.page + 1 })}
              className="tap-target focus-ring rounded border border-border px-3 disabled:opacity-50"
            >
              次へ
            </button>
          </nav>
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.type === 'disable'
            ? '問題を無効化'
            : pending?.type === 'delete'
              ? '問題を削除'
              : ''
        }
        message={
          pending?.type === 'disable' ? (
            <>
              <p>「{stemHead(pending.question.stem)}」を無効にします。</p>
              <label htmlFor={reasonId} className="mt-2 flex flex-col gap-1">
                <span>無効化の理由（任意）</span>
                <textarea
                  id={reasonId}
                  value={pending.reason}
                  onChange={(e) => setPending({ ...pending, reason: e.target.value })}
                  className="focus-ring min-h-[44px] min-w-0 rounded border border-border bg-bg px-2"
                />
              </label>
            </>
          ) : pending?.type === 'delete' ? (
            <>
              <p>「{stemHead(pending.question.stem)}」を削除します。</p>
              <p className="mt-1">削除すると一覧から消え、元に戻せません。</p>
            </>
          ) : null
        }
        confirmLabel={pending?.type === 'disable' ? '無効にする' : '削除する'}
        danger={pending?.type === 'delete'}
        busy={busy}
        error={pending ? error : null}
        onConfirm={() => void onConfirm()}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
      />
    </section>
  );
}

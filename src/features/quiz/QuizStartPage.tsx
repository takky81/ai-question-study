import { useEffect, useId, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Keyword, Subject } from '@/features/catalog/types';
import { listQuizCandidates, listQuizSubjects, listSubjectKeywords } from './api';
import { KeywordRangePicker } from './KeywordRangePicker';
import { countCandidates } from './order';
import { parseRangeParams, toRangeParams } from './range';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; value: T };

const BUTTON = 'tap-target focus-ring rounded border px-4 disabled:opacity-50';

function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p role="alert" className="min-w-0 break-words text-warn">
        {message}
      </p>
      <button type="button" onClick={onRetry} className={`${BUTTON} border-border`}>
        再試行
      </button>
    </div>
  );
}

/**
 * 出題範囲の選択画面（1.1、1.5、1.6、1.7、1.9、10.5）。
 * URL の subject／keyword を初期選択にする。URL の科目が一覧にない場合は未選択、
 * keyword が科目のキーワードにない場合（削除済みなど）は科目全体として扱い、存在しないキーワードで候補を取得しない。
 */
export function QuizStartPage(): ReactElement {
  const headingId = useId();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => parseRangeParams(searchParams));
  const [subjectId, setSubjectId] = useState<string | null>(initial?.subjectId ?? null);
  const [keywordId, setKeywordId] = useState<string | null>(initial?.keywordId ?? null);

  const [subjectsTry, setSubjectsTry] = useState(0);
  const [subjects, setSubjects] = useState<Load<Subject[]>>({ status: 'loading' });
  const [keywordsTry, setKeywordsTry] = useState(0);
  // どの科目のキーワードかを持ち、科目を切り替えた直後に前の科目の木を使わない
  const [keywords, setKeywords] = useState<Load<{ subjectId: string; list: Keyword[] }>>({ status: 'loading' });
  const [candidatesTry, setCandidatesTry] = useState(0);
  const [counts, setCounts] = useState<Load<{ key: string; total: number; unseen: number }>>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setSubjects({ status: 'loading' });
    listQuizSubjects().then(
      (value) => {
        if (active) setSubjects({ status: 'ok', value });
      },
      (e: unknown) => {
        if (active) setSubjects({ status: 'error', message: messageOf(e) });
      },
    );
    return () => {
      active = false;
    };
  }, [subjectsTry]);

  const subjectList = subjects.status === 'ok' ? subjects.value : [];
  const activeSubjectId = subjectList.some((s) => s.id === subjectId) ? subjectId : null;

  useEffect(() => {
    if (activeSubjectId === null) return;
    let active = true;
    setKeywords({ status: 'loading' });
    listSubjectKeywords(activeSubjectId).then(
      (list) => {
        if (!active) return;
        setKeywords({ status: 'ok', value: { subjectId: activeSubjectId, list } });
        setKeywordId((k) => (k !== null && !list.some((kw) => kw.id === k) ? null : k));
      },
      (e: unknown) => {
        if (active) setKeywords({ status: 'error', message: messageOf(e) });
      },
    );
    return () => {
      active = false;
    };
  }, [activeSubjectId, keywordsTry]);

  const keywordList =
    keywords.status === 'ok' && keywords.value.subjectId === activeSubjectId ? keywords.value.list : null;
  // キーワードの読み込み後、存在が確かめられた範囲だけを確定する
  const rangeKeywordId =
    keywordList !== null && (keywordId === null || keywordList.some((k) => k.id === keywordId)) ? keywordId : undefined;
  const rangeKey =
    activeSubjectId !== null && rangeKeywordId !== undefined
      ? toRangeParams({ subjectId: activeSubjectId, keywordId: rangeKeywordId }).toString()
      : null;

  // 確定した範囲を URL に置換で書き戻す（再読み込み・解答画面からの戻りで範囲を保つ）。
  // 初期選択は初回描画でだけ URL から読むため、書き戻しが選択を変えてループすることはない。
  // 候補の取得は rangeKey に依存し URL には依存しないので、書き戻しで再取得もしない。
  const searchKey = searchParams.toString();
  useEffect(() => {
    if (rangeKey !== null && rangeKey !== searchKey) {
      setSearchParams(new URLSearchParams(rangeKey), { replace: true });
    }
  }, [rangeKey, searchKey, setSearchParams]);

  useEffect(() => {
    if (rangeKey === null) return;
    const range = parseRangeParams(new URLSearchParams(rangeKey));
    if (range === null) return;
    // 範囲を素早く変えたとき、古い応答は破棄する
    let active = true;
    setCounts({ status: 'loading' });
    listQuizCandidates(range).then(
      (c) => {
        if (active) setCounts({ status: 'ok', value: { key: rangeKey, ...countCandidates(c) } });
      },
      (e: unknown) => {
        if (active) setCounts({ status: 'error', message: messageOf(e) });
      },
    );
    return () => {
      active = false;
    };
  }, [rangeKey, candidatesTry]);

  const current = counts.status === 'ok' && counts.value.key === rangeKey ? counts.value : null;
  const canStart = rangeKey !== null && current !== null && current.total > 0;

  function selectSubject(id: string) {
    if (id === activeSubjectId) return;
    setSubjectId(id);
    setKeywordId(null);
  }

  return (
    <section aria-labelledby={headingId} className="mx-auto flex w-full min-w-0 max-w-[40rem] flex-col gap-4">
      <h2 id={headingId} className="text-lg font-bold">
        出題範囲の選択
      </h2>

      {subjects.status === 'loading' && <p className="text-text-muted">読み込み中…</p>}
      {subjects.status === 'error' && (
        <ErrorRetry message={subjects.message} onRetry={() => setSubjectsTry((n) => n + 1)} />
      )}
      {subjects.status === 'ok' &&
        (subjectList.length === 0 ? (
          <p className="text-text-muted">科目はまだありません</p>
        ) : (
          <ul aria-label="科目" className="flex min-w-0 flex-wrap gap-2">
            {subjectList.map((s) => {
              const selected = s.id === activeSubjectId;
              return (
                <li key={s.id} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectSubject(s.id)}
                    className={`${BUTTON} max-w-full break-words text-left ${
                      selected ? 'border-2 border-primary font-bold' : 'border-border'
                    }`}
                  >
                    {s.name}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

      {activeSubjectId !== null && (
        <div className="min-w-0">
          {keywords.status === 'error' ? (
            <ErrorRetry message={keywords.message} onRetry={() => setKeywordsTry((n) => n + 1)} />
          ) : keywordList === null ? (
            <p className="text-text-muted">読み込み中…</p>
          ) : (
            <KeywordRangePicker keywords={keywordList} selectedKeywordId={rangeKeywordId ?? null} onSelect={setKeywordId} />
          )}
        </div>
      )}

      {rangeKey !== null && (
        <div aria-live="polite" className="min-w-0 break-words">
          {counts.status === 'error' ? (
            <ErrorRetry message={counts.message} onRetry={() => setCandidatesTry((n) => n + 1)} />
          ) : current === null ? (
            <p className="text-text-muted">件数を取得中…</p>
          ) : current.total === 0 ? (
            <p className="text-text-muted">この範囲には出題できる問題がありません</p>
          ) : (
            <p>
              出題対象 {current.total} 問（未出題 {current.unseen} 問）
            </p>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          disabled={!canStart}
          onClick={() => {
            if (rangeKey !== null) void navigate(`/quiz/play?${rangeKey}`);
          }}
          className={`${BUTTON} border-primary bg-primary font-bold text-bg`}
        >
          開始
        </button>
      </div>
    </section>
  );
}

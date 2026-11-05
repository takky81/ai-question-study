// 解答画面: 出題・解答・記録・次へ・終了のオーケストレーション（1.7、2.4、2.5、3.3〜3.5、5.8、7.7、10.2、10.5、10.6）。
// 進行は sessionReducer に委ね、I/O は各フェーズの effect で行う。問題や記録の切り替わり後・アンマウント後に届いた古い応答は破棄する。
import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { KeywordNode } from '@/lib/keywordTree';
import { AnswerFeedback } from './AnswerFeedback';
import {
  getQuizQuestion,
  listOpenFlags,
  listQuizCandidates,
  listSubjectKeywords,
  recordAnswer,
  saveQuestionFlags,
} from './api';
import { ChoiceList } from './ChoiceList';
import { FlagForm } from './FlagForm';
import { createFlagSaver, type FlagSaveStatus, type FlagSaver } from './flagAutosave';
import type { CheckboxFlagId } from './flags';
import { QuestionStatsBar } from './QuestionStatsBar';
import { parseRangeParams, toRangeParams } from './range';
import { createInitialSession, nextQuestionId, sessionReducer } from './session';
import { SessionSummary } from './SessionSummary';
import type { AnswerKind } from './types';

const BUTTON = 'tap-target focus-ring rounded border px-4 disabled:opacity-50';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type OpenFlags = { questionId: string; flags: CheckboxFlagId[]; comment: string | null; saver: FlagSaver };

const IDLE: FlagSaveStatus = { kind: 'idle' };
const noopSubscribe = () => () => {};

export function QuizPlayPage(): ReactElement | null {
  const headingId = useId();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const range = useMemo(() => parseRangeParams(new URLSearchParams(searchKey)), [searchKey]);
  const rangeKey = range === null ? null : toRangeParams(range).toString();

  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSession);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTry, setLoadTry] = useState(0);
  const [keywords, setKeywords] = useState<readonly KeywordNode[]>([]);
  const [openFlags, setOpenFlags] = useState<OpenFlags | null>(null);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [flagsTry, setFlagsTry] = useState(0);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  // 「次へ」「終了」の flush 待機中か。ボタンは disabled にせず（blur 直後の click を失わないため）二重クリックを無視する
  const leaving = useRef(false);

  // 範囲が不正なら範囲選択へ置換遷移する（1.7）
  useEffect(() => {
    if (range === null) void navigate('/quiz', { replace: true });
  }, [range, navigate]);

  // 候補を取得する。loadTry の増加で再取得する（10.5）
  useEffect(() => {
    if (range === null) return;
    let active = true;
    listQuizCandidates(range).then(
      (candidates) => {
        if (!active) return;
        setCandidatesLoaded(true);
        dispatch({ type: 'candidatesLoaded', candidates });
      },
      (e: unknown) => {
        if (!active) return;
        setLoadError(messageOf(e));
        dispatch({ type: 'loadFailed' });
      },
    );
    return () => {
      active = false;
    };
  }, [range, loadTry]);

  // キーワード（解説の階層パス用）を取得する
  useEffect(() => {
    if (range === null) return;
    let active = true;
    listSubjectKeywords(range.subjectId).then(
      (list) => {
        if (active) setKeywords(list);
      },
      () => {
        // キーワードは解説の補助表示のため、取得に失敗しても出題を続ける
      },
    );
    return () => {
      active = false;
    };
  }, [range]);

  // 読込中は次の問題を取得する。出題対象外（null）は飛ばす（2.4）
  const pendingId = candidatesLoaded && state.phase === 'loading' ? nextQuestionId(state) : null;
  useEffect(() => {
    if (pendingId === null) return;
    let active = true;
    getQuizQuestion(pendingId).then(
      (question) => {
        if (!active) return;
        dispatch(question === null ? { type: 'skipUnservable' } : { type: 'questionLoaded', question });
      },
      (e: unknown) => {
        if (!active) return;
        setLoadError(messageOf(e));
        dispatch({ type: 'loadFailed' });
      },
    );
    return () => {
      active = false;
    };
  }, [pendingId]);

  // 記録中は record_answer を呼ぶ。再試行も selection に保持した同じ冪等キーで送る（3.3、3.4）
  const currentId = state.current?.id ?? null;
  const selection = state.selection;
  const clientAnswerId = state.recordStatus === 'saving' && selection !== null ? selection.clientAnswerId : null;
  const selectionKind = selection?.kind ?? null;
  const selectionChoiceId = selection?.choiceId ?? null;
  useEffect(() => {
    if (clientAnswerId === null || currentId === null || selectionKind === null) return;
    let active = true;
    recordAnswer({ clientAnswerId, questionId: currentId, choiceId: selectionChoiceId, kind: selectionKind }).then(
      (result) => {
        if (active) dispatch({ type: 'recordSucceeded', result });
      },
      () => {
        if (active) dispatch({ type: 'recordFailed' });
      },
    );
    return () => {
      active = false;
    };
  }, [clientAnswerId, currentId, selectionKind, selectionChoiceId]);

  // 記録成功後に未解消フラグを取得する（7.7）
  const flagsQuestionId = state.recordStatus === 'saved' ? currentId : null;
  useEffect(() => {
    if (flagsQuestionId === null) return;
    let active = true;
    setFlagsError(null);
    listOpenFlags(flagsQuestionId).then(
      (r) => {
        if (!active) return;
        // 判定後の問題ごとに自動保存キューを1つ作る（7.2、7.4〜7.6、7.9）
        const saver = createFlagSaver({ flags: r.flags, comment: r.comment }, (s) =>
          saveQuestionFlags(flagsQuestionId, s.flags, s.comment ?? ''),
        );
        setOpenFlags({ questionId: flagsQuestionId, ...r, saver });
      },
      (e: unknown) => {
        if (active) setFlagsError(messageOf(e));
      },
    );
    return () => {
      active = false;
    };
  }, [flagsQuestionId, flagsTry]);

  // 新しい問題が出たら問題文の見出しへフォーカスを移す（キーボード・読み上げの利用者向け）
  useEffect(() => {
    if (currentId !== null) questionHeading.current?.focus();
  }, [currentId]);

  const current = state.current;
  const flags = openFlags !== null && openFlags.questionId === currentId ? openFlags : null;
  const saver = flags?.saver ?? null;
  const flagStatus = useSyncExternalStore(saver?.subscribe ?? noopSubscribe, () => saver?.getStatus() ?? IDLE);

  if (range === null || rangeKey === null) return null;

  // 未送信・送信中のフラグ保存を待ってから遷移する。失敗なら遷移せず FlagForm の失敗表示と再試行を残す（7.6）
  async function leaveAfterFlush(go: () => void) {
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (saver !== null && !(await saver.flush())) return;
      go();
    } finally {
      leaving.current = false;
    }
  }

  function answer(kind: AnswerKind, choiceId: string | null) {
    dispatch({ type: 'answered', kind, choiceId, clientAnswerId: crypto.randomUUID() });
  }

  // 読み込み失敗からの再試行。候補が未取得なら候補から、取得済みなら同じ候補で読込中へ戻して問題を取り直す
  function retryLoad() {
    setLoadError(null);
    if (candidatesLoaded) dispatch({ type: 'candidatesLoaded', candidates: state.candidates });
    else setLoadTry((n) => n + 1);
  }

  const judged = state.phase === 'judged';

  return (
    <section aria-labelledby={headingId} className="mx-auto flex w-full min-w-0 max-w-[40rem] flex-col gap-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-bold">
          出題
        </h2>
        {state.phase !== 'finished' && (
          <button
            type="button"
            onClick={() => void leaveAfterFlush(() => void navigate(`/quiz?${rangeKey}`))}
            className={`${BUTTON} border-border`}
          >
            終了
          </button>
        )}
      </div>

      {state.phase === 'finished' && (
        <SessionSummary answeredCount={state.summary.answered} correctCount={state.summary.correct} range={range} />
      )}

      {state.phase === 'error' && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p role="alert" className="min-w-0 break-words text-warn">
            {loadError ?? '問題を読み込めませんでした'}
          </p>
          <button type="button" onClick={retryLoad} className={`${BUTTON} border-border`}>
            再試行
          </button>
        </div>
      )}

      {state.phase === 'loading' && <p className="text-text-muted">読み込み中…</p>}

      {current !== null && (state.phase === 'answering' || judged) && (
        <>
          {state.stats !== null && <QuestionStatsBar stats={state.stats} />}
          <h3
            ref={questionHeading}
            tabIndex={-1}
            className="focus-ring min-w-0 whitespace-pre-wrap break-words text-base font-bold"
          >
            {current.stem}
          </h3>
          <ChoiceList
            choices={current.choices}
            selection={state.selection}
            correctChoiceId={state.correctChoiceId}
            disabled={judged}
            onAnswer={answer}
          />
          <AnswerFeedback
            judged={judged}
            explanation={current.explanation}
            keywordIds={current.keywordIds}
            keywords={keywords}
          />
          {state.recordStatus === 'saving' && <p className="text-text-muted">解答を記録中…</p>}
          {state.recordStatus === 'failed' && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 break-words text-warn">
                解答を記録できませんでした
              </p>
              <button
                type="button"
                onClick={() => dispatch({ type: 'retryRecord' })}
                className={`${BUTTON} border-border`}
              >
                再試行
              </button>
            </div>
          )}
          {state.recordStatus === 'saved' &&
            (flagsError !== null ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p role="alert" className="min-w-0 break-words text-warn">
                  {flagsError}
                </p>
                <button type="button" onClick={() => setFlagsTry((n) => n + 1)} className={`${BUTTON} border-border`}>
                  フラグを再取得
                </button>
              </div>
            ) : flags === null ? (
              <p className="text-text-muted">フラグを読み込み中…</p>
            ) : (
              <FlagForm
                key={current.id}
                initialFlags={flags.flags}
                initialComment={flags.comment}
                status={flagStatus}
                onChangeFlags={flags.saver.setFlags}
                onCommitComment={flags.saver.commitComment}
                onRetry={flags.saver.retry}
              />
            ))}
          <div>
            <button
              type="button"
              disabled={!judged || state.recordStatus !== 'saved'}
              onClick={() => void leaveAfterFlush(() => dispatch({ type: 'next' }))}
              className={`${BUTTON} border-primary bg-primary font-bold text-bg`}
            >
              次へ
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// 出題セッションの状態遷移（純粋関数、I/O なし）。冪等キー（clientAnswerId）は呼び出し側が作って渡す。
import { pickNextCandidate } from './order';
import { applyAnswerToStats } from './stats';
import type { AnswerKind, AnswerResult, QuestionStats, QuizCandidate, QuizQuestion } from './types';

export type SessionPhase = 'loading' | 'answering' | 'judged' | 'finished' | 'error';
export type RecordStatus = 'idle' | 'saving' | 'saved' | 'failed';

export type SessionState = {
  candidates: QuizCandidate[];
  answeredIds: ReadonlySet<string>;
  current: QuizQuestion | null;
  phase: SessionPhase;
  selection: { kind: AnswerKind; choiceId: string | null; clientAnswerId: string } | null;
  correctChoiceId: string | null; // 判定前は null
  recordStatus: RecordStatus;
  stats: QuestionStats | null; // 出題中の問題の成績
  summary: { answered: number; correct: number };
};

export type SessionAction =
  | { type: 'candidatesLoaded'; candidates: QuizCandidate[] }
  | { type: 'questionLoaded'; question: QuizQuestion }
  | { type: 'answered'; kind: AnswerKind; choiceId: string | null; clientAnswerId: string }
  | { type: 'recordSucceeded'; result: AnswerResult }
  | { type: 'recordFailed' }
  | { type: 'retryRecord' }
  | { type: 'skipUnservable' }
  | { type: 'next' }
  | { type: 'loadFailed' };

export function createInitialSession(): SessionState {
  return {
    candidates: [],
    answeredIds: new Set(),
    current: null,
    phase: 'loading',
    selection: null,
    correctChoiceId: null,
    recordStatus: 'idle',
    stats: null,
    summary: { answered: 0, correct: 0 },
  };
}

// 読込中に呼び出し側が取得すべき問題の ID。なければ null
export function nextQuestionId(state: SessionState): string | null {
  return pickNextCandidate(state.candidates, state.answeredIds)?.questionId ?? null;
}

// 次の問題へ進む。候補が残っていなければ終了にする
function advance(state: SessionState, answeredIds: ReadonlySet<string>): SessionState {
  const hasNext = pickNextCandidate(state.candidates, answeredIds) !== null;
  return {
    ...state,
    answeredIds,
    current: null,
    phase: hasNext ? 'loading' : 'finished',
    selection: null,
    correctChoiceId: null,
    recordStatus: 'idle',
    stats: null,
  };
}

function toStats(r: AnswerResult): QuestionStats {
  return {
    attemptCount: r.attemptCount,
    correctCount: r.correctCount,
    correctRate: r.correctRate,
    retention: r.retention,
    lastAnsweredAt: r.lastAnsweredAt,
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'candidatesLoaded':
      return advance({ ...state, candidates: action.candidates }, state.answeredIds);

    case 'questionLoaded':
      if (state.phase !== 'loading') return state;
      return {
        ...state,
        current: action.question,
        phase: 'answering',
        selection: null,
        correctChoiceId: null,
        recordStatus: 'idle',
        stats: action.question.stats,
      };

    case 'answered': {
      if (state.phase !== 'answering' || state.current === null) return state;
      const correctChoiceId = state.current.choices.find((c) => c.isCorrect)?.id ?? null;
      const isCorrect = action.choiceId !== null && action.choiceId === correctChoiceId;
      return {
        ...state,
        phase: 'judged',
        recordStatus: 'saving',
        selection: { kind: action.kind, choiceId: action.choiceId, clientAnswerId: action.clientAnswerId },
        correctChoiceId,
        stats: applyAnswerToStats(state.stats ?? state.current.stats, isCorrect),
      };
    }

    case 'recordSucceeded': {
      if (state.recordStatus !== 'saving' || state.current === null) return state;
      const { result } = action;
      const id = state.current.id;
      const stats = toStats(result);
      const answeredIds = new Set(state.answeredIds);
      answeredIds.add(id);
      return {
        ...state,
        recordStatus: 'saved',
        stats,
        correctChoiceId: result.correctChoiceId,
        candidates: state.candidates.map((c) => (c.questionId === id ? { ...c, ...stats } : c)),
        answeredIds,
        summary: {
          answered: state.summary.answered + 1,
          correct: state.summary.correct + (result.isCorrect ? 1 : 0),
        },
      };
    }

    case 'recordFailed':
      if (state.recordStatus !== 'saving') return state;
      return { ...state, recordStatus: 'failed' };

    case 'retryRecord':
      // selection（clientAnswerId を含む）はそのまま保つ
      if (state.recordStatus !== 'failed') return state;
      return { ...state, recordStatus: 'saving' };

    case 'skipUnservable': {
      if (state.phase !== 'loading') return state;
      const id = state.current?.id ?? nextQuestionId(state);
      if (id === null) return state;
      const answeredIds = new Set(state.answeredIds);
      answeredIds.add(id);
      return advance(state, answeredIds);
    }

    case 'next':
      if (state.phase !== 'judged' || state.recordStatus !== 'saved') return state;
      return advance(state, state.answeredIds);

    case 'loadFailed':
      return { ...state, phase: 'error' };
  }
}

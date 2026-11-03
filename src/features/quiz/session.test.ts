import { describe, expect, it } from 'vitest';
import { createInitialSession, nextQuestionId, sessionReducer, type SessionAction, type SessionState } from './session';
import type { AnswerResult, QuestionStats, QuizCandidate, QuizQuestion } from './types';

const empty: QuestionStats = { attemptCount: 0, correctCount: 0, correctRate: null, retention: null, lastAnsweredAt: null };

function cand(id: string, createdAt: string): QuizCandidate {
  return { ...empty, questionId: id, createdAt };
}

function question(id: string): QuizQuestion {
  return {
    id,
    subjectId: 's',
    kind: 'keyword',
    stem: `問題 ${id}`,
    explanation: '解説',
    keywordIds: [],
    choices: [
      { id: `${id}-c1`, body: 'A', explanation: 'a', isCorrect: true },
      { id: `${id}-c2`, body: 'B', explanation: 'b', isCorrect: false },
    ],
    stats: empty,
  };
}

function result(id: string, isCorrect: boolean, stats: Partial<QuestionStats> = {}): AnswerResult {
  return {
    attemptCount: 1,
    correctCount: isCorrect ? 1 : 0,
    correctRate: isCorrect ? 1 : 0,
    retention: 0.5,
    lastAnsweredAt: '2026-11-03T00:00:00Z',
    ...stats,
    answerId: `ans-${id}`,
    isCorrect,
    correctChoiceId: `${id}-c1`,
    alreadyRecorded: false,
  };
}

function run(actions: SessionAction[], start: SessionState = createInitialSession()): SessionState {
  return actions.reduce(sessionReducer, start);
}

const twoCandidates = [cand('q2', '2026-01-02T00:00:00Z'), cand('q1', '2026-01-01T00:00:00Z')];
const loadedQ1: SessionAction[] = [
  { type: 'candidatesLoaded', candidates: twoCandidates },
  { type: 'questionLoaded', question: question('q1') },
];

describe('sessionReducer', () => {
  it('初期状態は読込中で、候補読込で次の問題 ID が出題順で決まる', () => {
    expect(createInitialSession().phase).toBe('loading');
    const s = run([{ type: 'candidatesLoaded', candidates: twoCandidates }]);
    expect(s.phase).toBe('loading');
    expect(nextQuestionId(s)).toBe('q1');
  });

  it('候補が0件なら終了にする', () => {
    const s = run([{ type: 'candidatesLoaded', candidates: [] }]);
    expect(s.phase).toBe('finished');
    expect(nextQuestionId(s)).toBeNull();
  });

  it('問題読込で判定前の表示状態になる（正解・選択なし）', () => {
    const s = run(loadedQ1);
    expect(s).toMatchObject({ phase: 'answering', correctChoiceId: null, selection: null, recordStatus: 'idle' });
    expect(s.current?.id).toBe('q1');
    expect(s.stats).toEqual(empty);
  });

  it('解答で判定後・記録中になり、正解と成績を即時に反映する', () => {
    const s = run([...loadedQ1, { type: 'answered', kind: 'normal', choiceId: 'q1-c2', clientAnswerId: 'key-1' }]);
    expect(s).toMatchObject({ phase: 'judged', recordStatus: 'saving', correctChoiceId: 'q1-c1' });
    expect(s.selection).toEqual({ kind: 'normal', choiceId: 'q1-c2', clientAnswerId: 'key-1' });
    expect(s.stats).toMatchObject({ attemptCount: 1, correctCount: 0 });
    expect(s.summary).toEqual({ answered: 0, correct: 0 });
  });

  it('「わからない」は不正解として即時反映する', () => {
    const s = run([...loadedQ1, { type: 'answered', kind: 'unknown', choiceId: null, clientAnswerId: 'key-1' }]);
    expect(s.stats).toMatchObject({ attemptCount: 1, correctCount: 0 });
    expect(s.correctChoiceId).toBe('q1-c1');
  });

  it('記録中は2回目の解答と次への移動を受け付けない', () => {
    const saving = run([...loadedQ1, { type: 'answered', kind: 'normal', choiceId: 'q1-c1', clientAnswerId: 'key-1' }]);
    expect(sessionReducer(saving, { type: 'answered', kind: 'normal', choiceId: 'q1-c2', clientAnswerId: 'key-2' })).toBe(saving);
    expect(sessionReducer(saving, { type: 'next' })).toBe(saving);
    expect(sessionReducer(saving, { type: 'retryRecord' })).toBe(saving);
  });

  it('判定前は次へを受け付けない', () => {
    const answering = run(loadedQ1);
    expect(sessionReducer(answering, { type: 'next' })).toBe(answering);
  });

  it('記録失敗で判定表示を保ち、再試行で同じ冪等キーのまま記録中に戻る', () => {
    const failed = run([
      ...loadedQ1,
      { type: 'answered', kind: 'normal', choiceId: 'q1-c1', clientAnswerId: 'key-1' },
      { type: 'recordFailed' },
    ]);
    expect(failed).toMatchObject({ phase: 'judged', recordStatus: 'failed', correctChoiceId: 'q1-c1' });
    expect(sessionReducer(failed, { type: 'next' })).toBe(failed);
    expect(sessionReducer(failed, { type: 'answered', kind: 'normal', choiceId: 'q1-c2', clientAnswerId: 'key-2' })).toBe(failed);
    const retried = sessionReducer(failed, { type: 'retryRecord' });
    expect(retried.recordStatus).toBe('saving');
    expect(retried.selection?.clientAnswerId).toBe('key-1');
    expect(retried.stats).toMatchObject({ attemptCount: 1 });
  });

  it('記録成功で成績・候補・解答済み集合・集計を RPC の値で置き換える', () => {
    const s = run([
      ...loadedQ1,
      { type: 'answered', kind: 'normal', choiceId: 'q1-c1', clientAnswerId: 'key-1' },
      { type: 'recordSucceeded', result: result('q1', true, { attemptCount: 4, correctCount: 3, correctRate: 0.75 }) },
    ]);
    expect(s.recordStatus).toBe('saved');
    expect(s.stats).toEqual({ attemptCount: 4, correctCount: 3, correctRate: 0.75, retention: 0.5, lastAnsweredAt: '2026-11-03T00:00:00Z' });
    expect(s.candidates.find((c) => c.questionId === 'q1')).toMatchObject({ attemptCount: 4, retention: 0.5, createdAt: '2026-01-01T00:00:00Z' });
    expect(s.answeredIds.has('q1')).toBe(true);
    expect(s.summary).toEqual({ answered: 1, correct: 1 });
  });

  it('記録中でないときの記録成功は無視する', () => {
    const answering = run(loadedQ1);
    expect(sessionReducer(answering, { type: 'recordSucceeded', result: result('q1', true) })).toBe(answering);
  });

  it('記録成功後の次へで次の問題の読込に移り、最後の問題の後は終了する', () => {
    const afterFirst = run([
      ...loadedQ1,
      { type: 'answered', kind: 'normal', choiceId: 'q1-c1', clientAnswerId: 'key-1' },
      { type: 'recordSucceeded', result: result('q1', true) },
      { type: 'next' },
    ]);
    expect(afterFirst).toMatchObject({ phase: 'loading', current: null, selection: null, correctChoiceId: null, recordStatus: 'idle', stats: null });
    expect(nextQuestionId(afterFirst)).toBe('q2');
    const end = run(
      [
        { type: 'questionLoaded', question: question('q2') },
        { type: 'answered', kind: 'normal', choiceId: 'q2-c2', clientAnswerId: 'key-2' },
        { type: 'recordSucceeded', result: result('q2', false) },
        { type: 'next' },
      ],
      afterFirst,
    );
    expect(end.phase).toBe('finished');
    expect(end.summary).toEqual({ answered: 2, correct: 1 });
  });

  it('出題対象外のスキップは解答済みに加えて集計を変えずに進む', () => {
    const loading = run([{ type: 'candidatesLoaded', candidates: twoCandidates }]);
    const skipped = sessionReducer(loading, { type: 'skipUnservable' });
    expect(skipped.answeredIds.has('q1')).toBe(true);
    expect(skipped.summary).toEqual({ answered: 0, correct: 0 });
    expect(skipped.phase).toBe('loading');
    expect(nextQuestionId(skipped)).toBe('q2');
    expect(sessionReducer(skipped, { type: 'skipUnservable' }).phase).toBe('finished');
  });

  it('読込失敗でエラーになり、候補の再読込で復帰できる', () => {
    const err = sessionReducer(createInitialSession(), { type: 'loadFailed' });
    expect(err.phase).toBe('error');
    expect(sessionReducer(err, { type: 'candidatesLoaded', candidates: twoCandidates }).phase).toBe('loading');
  });

  it('入力の状態を変更しない', () => {
    const s = run([...loadedQ1, { type: 'answered', kind: 'normal', choiceId: 'q1-c1', clientAnswerId: 'key-1' }]);
    const ids = s.answeredIds;
    const cands = s.candidates;
    sessionReducer(s, { type: 'recordSucceeded', result: result('q1', true) });
    expect(ids.has('q1')).toBe(false);
    expect(cands.find((c) => c.questionId === 'q1')?.attemptCount).toBe(0);
  });
});

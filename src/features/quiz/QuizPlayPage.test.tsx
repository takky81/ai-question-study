// 解答画面: 解いて次へ、記録失敗と再試行（同じ冪等キー）、出題対象外のスキップ、全問解答で終了表示、不正な範囲の置換遷移
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  listQuizCandidates: vi.fn(),
  listSubjectKeywords: vi.fn(),
  getQuizQuestion: vi.fn(),
  recordAnswer: vi.fn(),
  listOpenFlags: vi.fn(),
  saveQuestionFlags: vi.fn(),
}));

import * as api from './api';
import { QuizPlayPage } from './QuizPlayPage';
import type { AnswerResult, QuizCandidate, QuizQuestion } from './types';

const m = vi.mocked(api);
const S1 = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function cand(id: string, createdAt: string): QuizCandidate {
  return { questionId: id, createdAt, attemptCount: 0, correctCount: 0, correctRate: null, retention: null, lastAnsweredAt: null };
}

function question(id: string, stem: string): QuizQuestion {
  return {
    id,
    subjectId: S1,
    kind: 'keyword',
    stem,
    explanation: `${stem}の解説`,
    keywordIds: [],
    choices: [
      { id: `${id}-c1`, body: `${stem}正解`, explanation: '', isCorrect: true },
      { id: `${id}-c2`, body: `${stem}誤り`, explanation: '', isCorrect: false },
    ],
    stats: { attemptCount: 0, correctCount: 0, correctRate: null, retention: null, lastAnsweredAt: null },
  };
}

function result(isCorrect: boolean, choice: string): AnswerResult {
  return {
    answerId: 'ans',
    isCorrect,
    correctChoiceId: choice,
    alreadyRecorded: false,
    attemptCount: 1,
    correctCount: isCorrect ? 1 : 0,
    correctRate: isCorrect ? 100 : 0,
    retention: 1,
    lastAnsweredAt: '2026-01-01T00:00:00Z',
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="loc">{loc.pathname + loc.search}</p>;
}

function renderPage(url = `/quiz/play?subject=${S1}`) {
  return render(
    <MemoryRouter initialEntries={['/quiz', url]} initialIndex={1}>
      <LocationProbe />
      <Routes>
        <Route path="/quiz" element={<p>範囲選択</p>} />
        <Route path="/quiz/play" element={<QuizPlayPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

let uuid = 0;
beforeEach(() => {
  vi.resetAllMocks();
  uuid = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-00000000000${++uuid}` as `${string}-${string}-${string}-${string}-${string}`);
  m.listQuizCandidates.mockResolvedValue([cand(Q1, '2026-01-01T00:00:00Z'), cand(Q2, '2026-01-02T00:00:00Z')]);
  m.listSubjectKeywords.mockResolvedValue([]);
  m.getQuizQuestion.mockImplementation(async (id) => (id === Q1 ? question(Q1, '問1') : question(Q2, '問2')));
  m.recordAnswer.mockImplementation(async (input) => result(input.choiceId?.endsWith('c1') ?? false, `${input.questionId}-c1`));
  m.listOpenFlags.mockResolvedValue({ flags: [], comment: null });
  m.saveQuestionFlags.mockResolvedValue();
});

async function firstStem(): Promise<string> {
  const h = await screen.findByRole('heading', { name: /^問[12]$/ });
  return h.textContent ?? '';
}

describe('QuizPlayPage', () => {
  it('問題を解いて次へ進み、全問解答で終了表示を出す', async () => {
    const user = userEvent.setup();
    renderPage();
    const s1 = await firstStem();
    await waitFor(() => expect(screen.getByRole('heading', { name: s1 })).toHaveFocus());
    const next = screen.getByRole('button', { name: '次へ' });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole('button', { name: `${s1}正解` }));
    expect(await screen.findByText(`${s1}の解説`)).toBeInTheDocument();
    await screen.findByRole('button', { name: 'フラグを保存' });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);

    const s2 = s1 === '問1' ? '問2' : '問1';
    await screen.findByRole('heading', { name: s2 });
    await user.click(screen.getByRole('button', { name: `${s2}誤り` }));
    await waitFor(() => expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '次へ' }));

    expect(await screen.findByText(/2 問解答/)).toBeInTheDocument();
    expect(screen.getByText(/正答 1 問/)).toBeInTheDocument();
    expect(m.recordAnswer).toHaveBeenCalledTimes(2);
    expect(m.listOpenFlags).toHaveBeenCalledTimes(2);
  });

  it('記録失敗で失敗表示を出して次へを不可にし、再試行は同じ冪等キーで送る', async () => {
    const user = userEvent.setup();
    m.recordAnswer.mockRejectedValueOnce(new Error('network'));
    renderPage();
    const s1 = await firstStem();
    await user.click(screen.getByRole('button', { name: `${s1}正解` }));
    expect(await screen.findByText('解答を記録できませんでした')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled();
    expect(screen.getByText(`${s1}の解説`)).toBeInTheDocument();
    expect(m.listOpenFlags).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled());
    expect(m.recordAnswer).toHaveBeenCalledTimes(2);
    const [a, b] = m.recordAnswer.mock.calls.map((c) => c[0].clientAnswerId);
    expect(a).toBe(b);
    expect(screen.queryByText('解答を記録できませんでした')).not.toBeInTheDocument();
  });

  it('出題対象外になった問題を飛ばす', async () => {
    const user = userEvent.setup();
    m.getQuizQuestion.mockImplementation(async (id) => (id === Q1 ? null : question(Q2, '問2')));
    m.listQuizCandidates.mockResolvedValue([cand(Q1, '2026-01-01T00:00:00Z'), cand(Q2, '2026-01-02T00:00:00Z')]);
    renderPage();
    // Q1 が先でも後でも、表示されるのは Q2 だけで、解いたら終了
    await screen.findByRole('heading', { name: '問2' });
    await user.click(screen.getByRole('button', { name: '問2正解' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(await screen.findByText(/1 問解答/)).toBeInTheDocument();
  });

  it('候補の取得に失敗したら再試行で候補から取り直して出題する', async () => {
    const user = userEvent.setup();
    m.listQuizCandidates.mockRejectedValueOnce(new Error('候補の取得に失敗'));
    renderPage();
    expect(await screen.findByText('候補の取得に失敗')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    await firstStem();
    expect(m.listQuizCandidates).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('候補の取得に失敗')).not.toBeInTheDocument();
  });

  it('問題の取得に失敗したら再試行で同じ問題を取り直し、解答済みと集計を保つ', async () => {
    const user = userEvent.setup();
    renderPage();
    const s1 = await firstStem();
    await user.click(screen.getByRole('button', { name: `${s1}正解` }));
    await waitFor(() => expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled());
    m.getQuizQuestion.mockRejectedValueOnce(new Error('問題の取得に失敗'));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(await screen.findByText('問題の取得に失敗')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    const s2 = s1 === '問1' ? '問2' : '問1';
    await screen.findByRole('heading', { name: s2 });
    const calls = m.getQuizQuestion.mock.calls.map((c) => c[0]);
    expect(calls[calls.length - 1]).toBe(calls[calls.length - 2]);
    expect(m.listQuizCandidates).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: `${s2}正解` }));
    await waitFor(() => expect(screen.getByRole('button', { name: '次へ' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(await screen.findByText(/2 問解答、正答 2 問/)).toBeInTheDocument();
  });

  it('終了ボタンで同じ範囲の範囲選択へ戻る', async () => {
    const user = userEvent.setup();
    renderPage();
    await firstStem();
    await user.click(screen.getByRole('button', { name: '終了' }));
    expect(screen.getByTestId('loc')).toHaveTextContent(`/quiz?subject=${S1}`);
  });

  it('範囲が不正なら範囲選択へ置換遷移する', async () => {
    renderPage('/quiz/play?subject=bad');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(/^\/quiz$/));
    expect(m.listQuizCandidates).not.toHaveBeenCalled();
  });
});

// 出題範囲の選択画面: 科目一覧、URL の範囲の初期選択、件数表示、0件での開始不可、開始での遷移、エラーと再試行、古い応答の破棄
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  listQuizSubjects: vi.fn(),
  listSubjectKeywords: vi.fn(),
  listQuizCandidates: vi.fn(),
}));

import * as api from './api';
import { QuizStartPage } from './QuizStartPage';
import type { QuizCandidate } from './types';

const m = vi.mocked(api);
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const K1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const K2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STALE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const subjects = [
  { id: S1, name: '基本情報', createdAt: '' },
  { id: S2, name: '応用情報', createdAt: '' },
];
const keywords = [
  { id: K1, subjectId: S1, parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: K2, subjectId: S1, parentId: K1, name: 'TCP', sortOrder: 0 },
];

function cand(id: string, attemptCount: number): QuizCandidate {
  return {
    questionId: id,
    createdAt: '2026-01-01T00:00:00Z',
    attemptCount,
    correctCount: 0,
    correctRate: null,
    retention: null,
    lastAnsweredAt: null,
  };
}

function PlayProbe() {
  const loc = useLocation();
  return <p>解答画面 {loc.search}</p>;
}

function LocationProbe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="loc">{loc.pathname + loc.search}</p>
      <button type="button" onClick={() => void navigate(-1)}>
        戻る
      </button>
    </>
  );
}

function renderPage(url = '/quiz', entries: string[] = [url]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <LocationProbe />
      <Routes>
        <Route path="/home" element={<p>ホーム</p>} />
        <Route path="/quiz" element={<QuizStartPage />} />
        <Route path="/quiz/play" element={<PlayProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.listQuizSubjects.mockResolvedValue(subjects);
  m.listSubjectKeywords.mockResolvedValue(keywords);
  m.listQuizCandidates.mockResolvedValue([cand('q1', 0), cand('q2', 3), cand('q3', 0)]);
});

describe('QuizStartPage', () => {
  it('科目を選ぶと科目全体の件数を表示し、途中ノードを選ぶとその範囲の件数に変わり、開始で解答画面へ移る', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '基本情報' }));
    expect(await screen.findByText('出題対象 3 問（未出題 2 問）')).toBeInTheDocument();
    expect(m.listQuizCandidates).toHaveBeenLastCalledWith({ subjectId: S1, keywordId: null });

    m.listQuizCandidates.mockResolvedValue([cand('q1', 1)]);
    await user.click(await screen.findByRole('treeitem', { name: /ネットワーク/ }));
    expect(await screen.findByText('出題対象 1 問（未出題 0 問）')).toBeInTheDocument();
    expect(m.listQuizCandidates).toHaveBeenLastCalledWith({ subjectId: S1, keywordId: K1 });

    await user.click(screen.getByRole('button', { name: '開始' }));
    expect(await screen.findByText(`解答画面 ?subject=${S1}&keyword=${K1}`)).toBeInTheDocument();
  });

  it('URL の範囲を初期選択にする', async () => {
    renderPage(`/quiz?subject=${S1}&keyword=${K2}`);
    expect(await screen.findByRole('treeitem', { name: /TCP/, selected: true })).toBeInTheDocument();
    await waitFor(() => expect(m.listQuizCandidates).toHaveBeenCalledWith({ subjectId: S1, keywordId: K2 }));
    expect(screen.getByRole('button', { name: '基本情報' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('URL のキーワードが科目にない場合は科目全体として扱う', async () => {
    renderPage(`/quiz?subject=${S1}&keyword=${STALE}`);
    expect(await screen.findByRole('treeitem', { name: /科目全体/, selected: true })).toBeInTheDocument();
    await waitFor(() => expect(m.listQuizCandidates).toHaveBeenCalledWith({ subjectId: S1, keywordId: null }));
    expect(m.listQuizCandidates).not.toHaveBeenCalledWith({ subjectId: S1, keywordId: STALE });
  });

  it('出題対象が0件なら理由を表示して開始を無効にする', async () => {
    m.listQuizCandidates.mockResolvedValue([]);
    renderPage(`/quiz?subject=${S1}`);
    expect(await screen.findByText('この範囲には出題できる問題がありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始' })).toBeDisabled();
  });

  it('科目未選択では開始できない', async () => {
    renderPage();
    await screen.findByRole('button', { name: '基本情報' });
    expect(screen.getByRole('button', { name: '開始' })).toBeDisabled();
  });

  it('科目の取得失敗でエラーと再試行を表示し、再試行で回復する', async () => {
    const user = userEvent.setup();
    m.listQuizSubjects.mockRejectedValueOnce(new Error('科目の取得に失敗しました: x'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('科目の取得に失敗しました: x');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('button', { name: '基本情報' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('候補の取得失敗でエラーと再試行を表示し、開始を無効にする', async () => {
    const user = userEvent.setup();
    m.listQuizCandidates.mockRejectedValueOnce(new Error('出題候補の取得に失敗しました: y'));
    renderPage(`/quiz?subject=${S1}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('出題候補の取得に失敗しました: y');
    expect(screen.getByRole('button', { name: '開始' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByText('出題対象 3 問（未出題 2 問）')).toBeInTheDocument();
  });

  it('範囲を素早く変えたとき、古い応答で新しい件数を上書きしない', async () => {
    const user = userEvent.setup();
    let resolveOld: (v: QuizCandidate[]) => void = () => {};
    m.listQuizCandidates
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValue([cand('q1', 0)]);
    renderPage(`/quiz?subject=${S1}`);
    await waitFor(() => expect(m.listQuizCandidates).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('treeitem', { name: /ネットワーク/ }));
    expect(await screen.findByText('出題対象 1 問（未出題 1 問）')).toBeInTheDocument();
    resolveOld([cand('a', 0), cand('b', 0), cand('c', 0), cand('d', 0)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('出題対象 1 問（未出題 1 問）')).toBeInTheDocument();
    expect(screen.queryByText(/出題対象 4 問/)).not.toBeInTheDocument();
  });

  it('選択を URL に置換で書き戻し、その URL での再表示で選択を復元する', async () => {
    const user = userEvent.setup();
    const first = renderPage('/quiz', ['/home', '/quiz']);
    await user.click(await screen.findByRole('button', { name: '基本情報' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(`/quiz?subject=${S1}`));
    await user.click(await screen.findByRole('treeitem', { name: /ネットワーク/ }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(`/quiz?subject=${S1}&keyword=${K1}`));
    const url = screen.getByTestId('loc').textContent!;
    await waitFor(() => expect(m.listQuizCandidates).toHaveBeenCalledTimes(2));
    // 置換なので戻ると範囲選択より前の画面に戻る
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(await screen.findByText('ホーム')).toBeInTheDocument();
    first.unmount();

    renderPage(url);
    expect(await screen.findByRole('treeitem', { name: /ネットワーク/, selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent(url);
  });

  it('URL の古いキーワードを科目全体に戻したとき URL からも外す', async () => {
    renderPage(`/quiz?subject=${S1}&keyword=${STALE}`);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(`/quiz?subject=${S1}`));
    await waitFor(() => expect(m.listQuizCandidates).toHaveBeenCalledTimes(1));
  });

  it('キーワードの取得失敗でエラーと再試行を表示し、再試行で木を表示する', async () => {
    const user = userEvent.setup();
    m.listSubjectKeywords.mockRejectedValueOnce(new Error('キーワードの取得に失敗しました: z'));
    renderPage(`/quiz?subject=${S1}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('キーワードの取得に失敗しました: z');
    expect(screen.getByRole('button', { name: '開始' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('treeitem', { name: /ネットワーク/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

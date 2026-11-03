// 問題編集画面: 新規の原則数、既存の読み込み、エラー時は保存しない、警告の確認後保存、保存中の無効化、
// 失敗時の入力保持、見つからない場合、未保存の破棄確認（4.4、4.6、4.7、4.8、5.8、5.9、9.6）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  listKeywords: vi.fn(),
  getQuestion: vi.fn(),
  saveQuestion: vi.fn(),
}));

import * as api from './api';
import { QuestionEditPage } from './QuestionEditPage';
import type { Keyword, Question } from './types';

const m = vi.mocked(api);

// jsdom の AbortSignal は Node の Request が受け付けないため、データルーターの遷移用に signal を外す。
class TestRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {};
    super(input, rest);
  }
}
vi.stubGlobal('Request', TestRequest);

const KEYWORDS: Keyword[] = [{ id: 'k1', subjectId: '11111111-1111-4111-8111-111111111111', parentId: null, name: 'TCP', sortOrder: 0 }];

function question(over: Partial<Question> = {}): Question {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    subjectId: '11111111-1111-4111-8111-111111111111',
    kind: 'feature',
    stem: '信頼性のある通信は？',
    explanation: '再送制御がある。',
    keywordIds: ['k1'],
    choices: ['甲', '乙', '丙', '丁'].map((body, i) => ({
      id: `c${i}`,
      body,
      explanation: `${body}の解説`,
      isCorrect: i === 0,
    })),
    status: 'active',
    disabledReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/catalog/:subjectId', element: <p>一覧画面</p> },
      { path: '/catalog/:subjectId/questions/new', element: <QuestionEditPage /> },
      { path: '/catalog/:subjectId/questions/:questionId', element: <QuestionEditPage /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.listKeywords.mockResolvedValue(KEYWORDS);
  m.getQuestion.mockResolvedValue(question());
  m.saveQuestion.mockResolvedValue('33333333-3333-4333-8333-333333333333');
});

describe('QuestionEditPage', () => {
  it('新規はキーワード問題の6個の空欄で開き、種別を変えると4個になる', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/new');
    expect(await screen.findAllByLabelText(/選択肢 \d の本文/)).toHaveLength(6);
    await user.click(screen.getByLabelText('特徴などを答える問題'));
    expect(screen.getAllByLabelText(/選択肢 \d の本文/)).toHaveLength(4);
  });

  it('既存の問題を保存済みの内容で開く', async () => {
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    expect(await screen.findByLabelText('問題文')).toHaveValue('信頼性のある通信は？');
    expect(screen.getAllByLabelText(/選択肢 \d の本文/)).toHaveLength(4);
    expect(m.getQuestion).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333');
  });

  it('エラーがあれば保存せず、欄の近くに説明を結び付ける', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/new');
    await screen.findByLabelText('問題文');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(m.saveQuestion).not.toHaveBeenCalled();
    const stem = screen.getByLabelText('問題文');
    const id = stem.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveTextContent('問題文を入力してください');
  });

  it('入力ごとに検証を再計算する', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/new');
    await user.click(await screen.findByRole('button', { name: '保存' }));
    expect(screen.getByText(/問題文を入力してください/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('問題文'), 'あ');
    expect(screen.queryByText(/問題文を入力してください/)).not.toBeInTheDocument();
  });

  it('警告だけなら警告一覧を表示し、確認後に保存する', async () => {
    const user = userEvent.setup();
    m.getQuestion.mockResolvedValue(question({ stem: 'TLS とは？' }));
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    await user.click(await screen.findByRole('button', { name: '保存' }));
    expect(m.saveQuestion).not.toHaveBeenCalled();
    expect(screen.getByText('警告があります。内容を確認してください。')).toBeInTheDocument();
    expect(screen.getAllByText(/略語 TLS/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '警告を確認して保存' }));
    await waitFor(() => expect(m.saveQuestion).toHaveBeenCalledTimes(1));
    expect(m.saveQuestion.mock.calls[0]![0]).toMatchObject({ id: '33333333-3333-4333-8333-333333333333', stem: 'TLS とは？' });
  });

  it('保存中は保存操作を無効にし、失敗時は入力を保持して日本語のエラーを出す', async () => {
    const user = userEvent.setup();
    let reject!: (e: Error) => void;
    m.saveQuestion.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    const stem = await screen.findByLabelText('問題文');
    await user.clear(stem);
    await user.type(stem, '変更後');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('button', { name: /保存中/ })).toBeDisabled();
    reject(new Error('問題の保存に失敗しました: boom'));
    expect(await screen.findByRole('alert')).toHaveTextContent('問題の保存に失敗しました');
    expect(screen.getByLabelText('問題文')).toHaveValue('変更後');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('削除済み・存在しない問題は「見つかりません」と一覧への導線を表示する', async () => {
    m.getQuestion.mockResolvedValue(null);
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/44444444-4444-4444-8444-444444444444');
    expect(await screen.findByText(/見つかりません/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /一覧へ戻る/ })).toHaveAttribute('href', '/catalog/11111111-1111-4111-8111-111111111111');
  });

  it('未保存の変更がある間は画面内の遷移で破棄を確認する', async () => {
    const user = userEvent.setup();
    const router = renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    await user.type(await screen.findByLabelText('問題文'), '追記');
    await user.click(screen.getByRole('link', { name: /一覧へ戻る/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('変更を破棄');
    expect(router.state.location.pathname).toBe('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    await user.click(screen.getByRole('button', { name: '破棄して移動' }));
    expect(await screen.findByText('一覧画面')).toBeInTheDocument();
  });

  it('未保存の変更がある間はブラウザの離脱を確認する', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    await user.type(await screen.findByLabelText('問題文'), '追記');
    const ev2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });

  it('変更なしなら遷移で確認しない', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    await screen.findByLabelText('問題文');
    await user.click(screen.getByRole('link', { name: /一覧へ戻る/ }));
    expect(await screen.findByText('一覧画面')).toBeInTheDocument();
  });

  it('UUID でない問題 ID は API を呼ばずに「見つかりません」を表示する', async () => {
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/abc');
    expect(await screen.findByText(/見つかりません/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /一覧へ戻る/ })).toHaveAttribute('href', '/catalog/11111111-1111-4111-8111-111111111111');
    expect(m.getQuestion).not.toHaveBeenCalled();
    expect(m.listKeywords).not.toHaveBeenCalled();
  });

  it('UUID でない科目 ID の新規作成も「見つかりません」を表示する', async () => {
    renderAt('/catalog/x/questions/new');
    expect(await screen.findByText(/見つかりません/)).toBeInTheDocument();
    expect(m.listKeywords).not.toHaveBeenCalled();
  });

  it('保存の連打でも1回だけ保存する', async () => {
    const user = userEvent.setup();
    m.saveQuestion.mockReturnValue(new Promise(() => {}));
    renderAt('/catalog/11111111-1111-4111-8111-111111111111/questions/33333333-3333-4333-8333-333333333333');
    await user.type(await screen.findByLabelText('問題文'), '追記');
    const btn = screen.getByRole('button', { name: '保存' });
    btn.click();
    btn.click();
    await waitFor(() => expect(m.saveQuestion).toHaveBeenCalledTimes(1));
    expect(m.saveQuestion).toHaveBeenCalledTimes(1);
  });
});

// 問題一覧: 階層パス、件数とページ送り、0件、エラーと再試行、URL の絞り込み、無効化・有効化・削除
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  QUESTION_PAGE_SIZE: 50,
  listKeywords: vi.fn(),
  searchQuestions: vi.fn(),
  setQuestionDisabled: vi.fn(),
  deleteQuestion: vi.fn(),
}));

import * as api from './api';
import { QuestionList } from './QuestionList';
import type { Keyword, QuestionListItem } from './types';

const m = vi.mocked(api);

const KEYWORDS: Keyword[] = [
  { id: 'k1', subjectId: 's1', parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: 'k2', subjectId: 's1', parentId: 'k1', name: 'TCP', sortOrder: 0 },
];

function item(over: Partial<QuestionListItem> = {}): QuestionListItem {
  return {
    id: 'q1',
    kind: 'keyword',
    stem: '3ウェイハンドシェイクを行うプロトコルは？',
    status: 'active',
    keywordIds: ['k2'],
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

let currentSearch = '';
function LocationProbe() {
  currentSearch = useLocation().search;
  return null;
}

function renderList(initial = '/catalog/s1') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <QuestionList subjectId="s1" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  currentSearch = '';
  m.listKeywords.mockResolvedValue(KEYWORDS);
  m.searchQuestions.mockResolvedValue({ items: [item()], total: 1 });
});

describe('QuestionList', () => {
  it('問題文・種別・状態・キーワードの階層パス・件数・編集リンクを表示する', async () => {
    renderList();
    const row = (await screen.findByText('3ウェイハンドシェイクを行うプロトコルは？')).closest('li')!;
    const r = within(row);
    expect(await r.findByText('ネットワーク / TCP')).toBeInTheDocument();
    expect(r.getByText('キーワード問題')).toBeInTheDocument();
    expect(r.getByText('有効')).toBeInTheDocument();
    expect(r.getByRole('link', { name: /編集/ })).toHaveAttribute('href', '/catalog/s1/questions/q1');
    expect(screen.getByText('1 件')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '問題を作成' })).toHaveAttribute(
      'href',
      '/catalog/s1/questions/new',
    );
  });

  it('問題文は冒頭80文字までを表示する', async () => {
    m.searchQuestions.mockResolvedValue({ items: [item({ stem: 'あ'.repeat(100) })], total: 1 });
    renderList();
    expect(await screen.findByText(`${'あ'.repeat(80)}…`)).toBeInTheDocument();
  });

  it('0件のとき該当なしを表示する', async () => {
    m.searchQuestions.mockResolvedValue({ items: [], total: 0 });
    renderList();
    expect(await screen.findByText('条件に一致する問題はありません')).toBeInTheDocument();
  });

  it('取得に失敗するとエラーと再試行を表示し、再試行で再取得する', async () => {
    const user = userEvent.setup();
    m.searchQuestions.mockRejectedValueOnce(new Error('問題の検索に失敗しました: boom'));
    renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent('問題の検索に失敗しました: boom');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByText('3ウェイハンドシェイクを行うプロトコルは？')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('URL の条件で検索し、条件を変えると URL に書き込んで1ページ目から検索する', async () => {
    const user = userEvent.setup();
    renderList('/catalog/s1?keyword=k1&kind=feature&page=2');
    await screen.findByText('3ウェイハンドシェイクを行うプロトコルは？');
    expect(m.searchQuestions).toHaveBeenLastCalledWith('s1', {
      keywordId: 'k1',
      kind: 'feature',
      status: null,
      text: '',
      page: 2,
    });
    expect(await screen.findByText('ネットワーク')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('状態'), 'disabled');
    await waitFor(() => expect(currentSearch).toBe('?keyword=k1&kind=feature&status=disabled'));
    await user.type(screen.getByLabelText('語'), 'TCP');
    await user.click(screen.getByRole('button', { name: '検索' }));
    await waitFor(() =>
      expect(m.searchQuestions).toHaveBeenLastCalledWith('s1', {
        keywordId: 'k1',
        kind: 'feature',
        status: 'disabled',
        text: 'TCP',
        page: 1,
      }),
    );
    expect(currentSearch).toContain('q=TCP');

    await user.click(screen.getByRole('button', { name: 'キーワードの指定を解除' }));
    await waitFor(() => expect(currentSearch).not.toContain('keyword='));
  });

  it('ページ送りで URL のページを変え、端では前へ／次へを無効にする', async () => {
    const user = userEvent.setup();
    m.searchQuestions.mockResolvedValue({ items: [item()], total: 120 });
    renderList();
    expect(await screen.findByText('120 件')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 ページ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前へ' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(currentSearch).toBe('?page=2'));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(currentSearch).toBe('?page=3'));
    expect(await screen.findByText('3 / 3 ページ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled();
    expect(m.searchQuestions).toHaveBeenLastCalledWith('s1', expect.objectContaining({ page: 3 }));
  });

  it('無効化は理由を任意で入力して確定し、再取得する', async () => {
    const user = userEvent.setup();
    m.setQuestionDisabled.mockResolvedValue();
    renderList();
    await user.click(await screen.findByRole('button', { name: /を無効化$/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('無効化の理由（任意）'), '古い');
    m.searchQuestions.mockResolvedValue({ items: [item({ status: 'disabled' })], total: 1 });
    await user.click(within(dialog).getByRole('button', { name: '無効にする' }));
    expect(m.setQuestionDisabled).toHaveBeenCalledWith('q1', true, '古い');
    expect(await screen.findByRole('button', { name: /を有効に戻す$/ })).toBeInTheDocument();
    const row = screen.getByText('3ウェイハンドシェイクを行うプロトコルは？').closest('li')!;
    expect(within(row).getByText('無効')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('有効に戻す失敗は日本語のエラーを表示する', async () => {
    const user = userEvent.setup();
    m.searchQuestions.mockResolvedValue({ items: [item({ status: 'disabled' })], total: 1 });
    m.setQuestionDisabled.mockRejectedValue(new Error('紐づくキーワードがないため有効にできません'));
    renderList();
    await user.click(await screen.findByRole('button', { name: /を有効に戻す$/ }));
    expect(m.setQuestionDisabled).toHaveBeenCalledWith('q1', false);
    expect(await screen.findByRole('alert')).toHaveTextContent('紐づくキーワードがないため有効にできません');
  });

  it('削除は元に戻せない旨を確認してから削除し、再取得する', async () => {
    const user = userEvent.setup();
    m.deleteQuestion.mockResolvedValue();
    renderList();
    await user.click(await screen.findByRole('button', { name: /を削除$/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('削除すると一覧から消え、元に戻せません');
    m.searchQuestions.mockResolvedValue({ items: [], total: 0 });
    await user.click(within(dialog).getByRole('button', { name: '削除する' }));
    expect(m.deleteQuestion).toHaveBeenCalledWith('q1');
    expect(await screen.findByText('条件に一致する問題はありません')).toBeInTheDocument();
  });

  it('2ページ目の唯一の行を削除すると前のページへ移って検索する', async () => {
    const user = userEvent.setup();
    m.searchQuestions.mockResolvedValue({ items: [item()], total: 51 });
    m.deleteQuestion.mockResolvedValue();
    renderList('/catalog/s1?page=2');
    await user.click(await screen.findByRole('button', { name: /を削除$/ }));
    m.searchQuestions.mockClear();
    m.searchQuestions.mockResolvedValue({ items: [item({ id: 'q2' })], total: 50 });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(currentSearch).toBe(''));
    await waitFor(() =>
      expect(m.searchQuestions).toHaveBeenCalledWith('s1', expect.objectContaining({ page: 1 })),
    );
    expect(m.searchQuestions).not.toHaveBeenCalledWith('s1', expect.objectContaining({ page: 2 }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('範囲外のページで取得に失敗したら最初のページへ戻れる', async () => {
    const user = userEvent.setup();
    m.searchQuestions.mockRejectedValueOnce(new Error('問題の検索に失敗しました: range'));
    renderList('/catalog/s1?page=99');
    expect(await screen.findByRole('alert')).toHaveTextContent('問題の検索に失敗しました: range');
    await user.click(screen.getByRole('button', { name: '最初のページへ' }));
    await waitFor(() => expect(currentSearch).toBe(''));
    expect(await screen.findByText('3ウェイハンドシェイクを行うプロトコルは？')).toBeInTheDocument();
    expect(m.searchQuestions).toHaveBeenLastCalledWith('s1', expect.objectContaining({ page: 1 }));
  });

  it('削除の失敗はダイアログ内に表示する', async () => {
    const user = userEvent.setup();
    m.deleteQuestion.mockRejectedValue(new Error('問題の削除に失敗しました: x'));
    renderList();
    await user.click(await screen.findByRole('button', { name: /を削除$/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '削除する' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('問題の削除に失敗しました: x');
  });
});

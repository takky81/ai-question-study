// 科目一覧: 作成・改名・削除と、日本語エラー・二重送信防止・削除前の件数表示
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  listSubjects: vi.fn(),
  createSubject: vi.fn(),
  renameSubject: vi.fn(),
  countSubjectContents: vi.fn(),
  deleteSubject: vi.fn(),
}));

import * as api from './api';
import { SubjectList } from './SubjectList';

const m = vi.mocked(api);
const S1 = { id: 's1', name: '基本情報', createdAt: '2026-01-01T00:00:00Z' };

function renderList() {
  return render(
    <MemoryRouter>
      <SubjectList />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.listSubjects.mockResolvedValue([S1]);
});

describe('SubjectList', () => {
  it('科目を一覧表示し、作成すると再取得して表示する', async () => {
    const user = userEvent.setup();
    renderList();
    expect(await screen.findByRole('link', { name: '基本情報' })).toHaveAttribute('href', '/catalog/s1');
    m.createSubject.mockResolvedValue({ id: 's2', name: '応用情報', createdAt: '' });
    m.listSubjects.mockResolvedValue([S1, { id: 's2', name: '応用情報', createdAt: '' }]);
    await user.type(screen.getByLabelText('新しい科目名'), '  応用情報 ');
    await user.click(screen.getByRole('button', { name: '科目を作成' }));
    expect(m.createSubject).toHaveBeenCalledWith('応用情報');
    expect(await screen.findByRole('link', { name: '応用情報' })).toBeInTheDocument();
  });

  it('空の名前は保存せずエラーを表示する', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole('link', { name: '基本情報' });
    await user.type(screen.getByLabelText('新しい科目名'), '   ');
    await user.click(screen.getByRole('button', { name: '科目を作成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('科目名を入力してください');
    expect(m.createSubject).not.toHaveBeenCalled();
  });

  it('重複名のエラーを日本語で表示する', async () => {
    const user = userEvent.setup();
    m.createSubject.mockRejectedValue(new Error('同じ名前がすでにあります'));
    renderList();
    await screen.findByRole('link', { name: '基本情報' });
    await user.type(screen.getByLabelText('新しい科目名'), '基本情報');
    await user.click(screen.getByRole('button', { name: '科目を作成' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('同じ名前がすでにあります');
  });

  it('作成中は送信ボタンを無効にし二重送信しない', async () => {
    const user = userEvent.setup();
    let resolve!: (v: typeof S1) => void;
    m.createSubject.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderList();
    await screen.findByRole('link', { name: '基本情報' });
    await user.type(screen.getByLabelText('新しい科目名'), '応用');
    const button = screen.getByRole('button', { name: '科目を作成' });
    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(m.createSubject).toHaveBeenCalledTimes(1);
    resolve({ ...S1, id: 's3' });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('改名する。空欄の改名はエラーで保存しない', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole('link', { name: '基本情報' });
    await user.click(screen.getByRole('button', { name: '基本情報 の名前を変更' }));
    const input = screen.getByLabelText('基本情報 の新しい名前');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('科目名を入力してください');
    expect(m.renameSubject).not.toHaveBeenCalled();

    m.renameSubject.mockResolvedValue();
    m.listSubjects.mockResolvedValue([{ ...S1, name: '基本情報技術者' }]);
    await user.type(input, '基本情報技術者');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(m.renameSubject).toHaveBeenCalledWith('s1', '基本情報技術者');
    expect(await screen.findByRole('link', { name: '基本情報技術者' })).toBeInTheDocument();
  });

  it('削除前に配下の件数を示し、確定で削除して一覧から消す', async () => {
    const user = userEvent.setup();
    m.countSubjectContents.mockResolvedValue({ keywordCount: 3, questionCount: 5 });
    m.deleteSubject.mockResolvedValue();
    renderList();
    await screen.findByRole('link', { name: '基本情報' });
    await user.click(screen.getByRole('button', { name: '基本情報 を削除' }));
    const dialog = await screen.findByRole('dialog', { name: '科目「基本情報」を削除' });
    expect(dialog).toHaveTextContent('キーワード 3 件');
    expect(dialog).toHaveTextContent('問題 5 件');
    expect(m.countSubjectContents).toHaveBeenCalledWith('s1');
    m.listSubjects.mockResolvedValue([]);
    await user.click(within(dialog).getByRole('button', { name: '削除する' }));
    expect(m.deleteSubject).toHaveBeenCalledWith('s1');
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '基本情報' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('削除の失敗をダイアログ内に表示する', async () => {
    const user = userEvent.setup();
    m.countSubjectContents.mockResolvedValue({ keywordCount: 0, questionCount: 0 });
    m.deleteSubject.mockRejectedValue(new Error('科目の削除に失敗しました: x'));
    renderList();
    await screen.findByRole('link', { name: '基本情報' });
    await user.click(screen.getByRole('button', { name: '基本情報 を削除' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '削除する' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('科目の削除に失敗しました: x');
  });

  it('一覧の取得失敗を表示する', async () => {
    m.listSubjects.mockRejectedValue(new Error('科目の取得に失敗しました: x'));
    renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent('科目の取得に失敗しました: x');
  });
});

// カタログ画面: 科目一覧／木と一覧の配置、木の選択による絞り込み、木の編集後の一覧更新、ルート登録
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./SubjectList', () => ({ SubjectList: () => <p>科目一覧スタブ</p> }));
vi.mock('./KeywordTree', () => ({
  KeywordTree: (p: { subjectId: string; selectedId: string | null; onSelect: (id: string | null) => void; onChanged?: () => void }) => (
    <div>
      <span>木:{p.subjectId}:{p.selectedId ?? 'なし'}</span>
      <button type="button" onClick={() => p.onSelect('k2')}>k2を選ぶ</button>
      <button type="button" onClick={() => p.onSelect(null)}>選択解除</button>
      <button type="button" onClick={() => p.onChanged?.()}>木を編集</button>
    </div>
  ),
}));
let listMounts = 0;
vi.mock('./QuestionList', async () => {
  const { useEffect } = await import('react');
  return {
    QuestionList: ({ subjectId }: { subjectId: string }) => {
      useEffect(() => {
        listMounts += 1;
      }, []);
      return <span>一覧:{subjectId}</span>;
    },
  };
});

import { APP_ROUTES, toNavItems } from '../../app/routes';
import { CatalogPage } from './CatalogPage';

let search = '';
function Probe() {
  search = useLocation().search;
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:subjectId" element={<CatalogPage />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}

describe('CatalogPage', () => {
  it('科目未指定なら科目一覧を表示する', () => {
    renderAt('/catalog');
    expect(screen.getByText('科目一覧スタブ')).toBeInTheDocument();
    expect(screen.queryByText(/^木:/)).toBeNull();
  });

  it('科目内では木と一覧を表示し、URL のキーワードを木の選択に渡す', () => {
    renderAt('/catalog/s1?keyword=k1');
    expect(screen.getByText('木:s1:k1')).toBeInTheDocument();
    expect(screen.getByText('一覧:s1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /科目一覧/ })).toHaveAttribute('href', '/catalog');
  });

  it('木でキーワードを選ぶと他の条件を保ったまま keyword を設定し、ページを1に戻す', async () => {
    renderAt('/catalog/s1?kind=feature&page=3');
    await userEvent.click(screen.getByRole('button', { name: 'k2を選ぶ' }));
    const p = new URLSearchParams(search);
    expect(p.get('keyword')).toBe('k2');
    expect(p.get('kind')).toBe('feature');
    expect(p.get('page')).toBeNull();
    expect(screen.getByText('木:s1:k2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '選択解除' }));
    expect(new URLSearchParams(search).get('keyword')).toBeNull();
  });

  it('木の編集後に一覧を再取得させる', async () => {
    renderAt('/catalog/s1');
    const before = listMounts;
    await userEvent.click(screen.getByRole('button', { name: '木を編集' }));
    expect(listMounts).toBe(before + 1);
  });

  it('モバイル幅用のタブで木と一覧を切り替える', async () => {
    renderAt('/catalog/s1');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['キーワード', '問題']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: '問題' }));
    expect(screen.getByRole('tab', { name: '問題' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: '問題' })).toHaveClass('lg:block');
    expect(screen.getByRole('tabpanel', { name: 'キーワード', hidden: true })).toHaveClass('hidden', 'lg:block');
  });
});

describe('ルート登録表（catalog）', () => {
  it('カタログの4ルートを保護ルートとして登録し、管理区分に導線を出す', () => {
    const paths = APP_ROUTES.map((r) => r.path);
    for (const p of ['catalog', 'catalog/:subjectId', 'catalog/:subjectId/questions/new', 'catalog/:subjectId/questions/:questionId']) {
      expect(paths).toContain(p);
      expect(APP_ROUTES.find((r) => r.path === p)?.public).toBeFalsy();
    }
    const nav = toNavItems(APP_ROUTES).find((n) => n.path === '/catalog');
    expect(nav).toMatchObject({ label: 'カタログ', group: 'manage', order: 1 });
  });
});

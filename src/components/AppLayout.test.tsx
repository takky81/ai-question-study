import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart3, BookOpen, Database } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AppLayout } from './AppLayout';
import type { NavItem } from './NavLinks';

const items: NavItem[] = [
  { path: '/quiz', label: '出題', group: 'learn', icon: BookOpen, order: 1 },
  { path: '/stats', label: '統計', group: 'learn', icon: BarChart3, order: 2 },
  { path: '/catalog', label: 'カタログ', group: 'manage', icon: Database, order: 1 },
];

function renderLayout(onSignOut: () => Promise<void>, navItems: readonly NavItem[] = items) {
  return render(
    <MemoryRouter initialEntries={['/quiz']}>
      <Routes>
        <Route element={<AppLayout navItems={navItems} onSignOut={onSignOut} />}>
          <Route path="/quiz" element={<p>出題画面</p>} />
          <Route path="/catalog" element={<p>カタログ画面</p>} />
          <Route path="/" element={<p>ホーム画面</p>} />
        </Route>
        <Route path="/login" element={<p>ログイン画面</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  it('ヘッダー・main の中に子画面を表示し、アプリ名はホームへのリンクになる', () => {
    renderLayout(vi.fn(async () => {}));
    expect(within(screen.getByRole('main')).getByText('出題画面')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'AI 問題学習' })).toHaveAttribute('href', '/');
  });

  it('PC 幅のサイドナビとモバイル幅の下部バーを responsive class で切り替える', () => {
    renderLayout(vi.fn(async () => {}));
    const side = screen.getByRole('navigation', { name: 'サイドナビゲーション' });
    const bottom = screen.getByRole('navigation', { name: '学習ナビゲーション' });
    expect(side).toHaveClass('hidden', 'lg:block');
    expect(bottom).toHaveClass('lg:hidden');
    expect(within(bottom).queryByText('カタログ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログアウト' }).closest('div')).toHaveClass('hidden', 'lg:flex');
  });

  it('learn 導線がなければ下部バーを表示しない', () => {
    renderLayout(vi.fn(async () => {}), items.filter((i) => i.group === 'manage'));
    expect(screen.queryByRole('navigation', { name: '学習ナビゲーション' })).not.toBeInTheDocument();
  });

  it('メニューを開閉でき、Escape と導線の選択で閉じる', async () => {
    const user = userEvent.setup();
    renderLayout(vi.fn(async () => {}));
    const button = screen.getByRole('button', { name: 'メニュー' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(within(screen.getByRole('navigation', { name: '管理メニュー' })).getByRole('link', { name: 'カタログ' }));
    expect(screen.getByText('カタログ画面')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('ログアウト成功でログイン画面へ遷移する', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn(async () => {});
    renderLayout(onSignOut);
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('ログイン画面')).toBeInTheDocument();
  });

  it('ログアウト失敗で日本語のエラーを表示し、画面に留まる', async () => {
    const user = userEvent.setup();
    renderLayout(vi.fn(async () => { throw new Error('ログアウトに失敗しました。'); }));
    await user.click(screen.getByRole('button', { name: 'ログアウト' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ログアウトに失敗しました。');
    expect(screen.getByText('出題画面')).toBeInTheDocument();
  });
});

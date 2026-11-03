import { render, screen, within } from '@testing-library/react';
import { BarChart3, BookOpen, Database, Upload } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { NavLinks, type NavItem } from './NavLinks';

const items: NavItem[] = [
  { path: '/stats', label: '統計', group: 'learn', icon: BarChart3, order: 2 },
  { path: '/quiz', label: '出題', group: 'learn', icon: BookOpen, order: 1 },
  { path: '/import', label: '入出力', group: 'manage', icon: Upload, order: 2 },
  { path: '/catalog', label: 'カタログ', group: 'manage', icon: Database, order: 1 },
];

function renderAt(path: string, navItems: readonly NavItem[], variant: 'sidebar' | 'bottom' | 'menu' = 'sidebar') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavLinks items={navItems} variant={variant} />
    </MemoryRouter>,
  );
}

describe('NavLinks', () => {
  it('渡した項目だけを区分ごとに表示順で描画する', () => {
    renderAt('/', items);
    const learn = screen.getByRole('region', { name: '学習' });
    const manage = screen.getByRole('region', { name: '管理' });
    expect(within(learn).getAllByRole('link').map((a) => a.textContent)).toEqual(['出題', '統計']);
    expect(within(manage).getAllByRole('link').map((a) => a.textContent)).toEqual(['カタログ', '入出力']);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('項目のない区分は見出しごと表示しない', () => {
    renderAt('/', items.filter((i) => i.group === 'learn'));
    expect(screen.queryByText('管理')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '管理' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '学習' })).toBeInTheDocument();
  });

  it('現在位置の導線に aria-current と色以外の強調を付ける', () => {
    renderAt('/quiz', items);
    const current = screen.getByRole('link', { name: '出題' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveClass('font-bold', 'underline');
    const other = screen.getByRole('link', { name: '統計' });
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).not.toHaveClass('font-bold');
  });

  it('下位パスでも親の導線を現在位置にする', () => {
    renderAt('/catalog/abc', items);
    expect(screen.getByRole('link', { name: 'カタログ' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '入出力' })).not.toHaveAttribute('aria-current');
  });

  it('下部バーでは現在位置を上ボーダーで示し、各導線を 44px 以上にする', () => {
    renderAt('/quiz', items.filter((i) => i.group === 'learn'), 'bottom');
    const current = screen.getByRole('link', { name: '出題' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveClass('font-bold', 'border-t-4');
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('tap-target');
  });
});

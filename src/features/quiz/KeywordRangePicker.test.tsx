// 出題範囲の木選択（1.2、1.4、1.9、10.3）
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { KeywordNode } from '../../lib/keywordTree';
import { KeywordRangePicker } from './KeywordRangePicker';

const keywords: KeywordNode[] = [
  { id: 'a', parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: 'a1', parentId: 'a', name: 'TCP/IP', sortOrder: 0 },
  { id: 'a1x', parentId: 'a1', name: 'TCP', sortOrder: 0 },
  { id: 'b', parentId: null, name: 'データベース', sortOrder: 1 },
];

function Harness({ initial = null, onSelect }: { initial?: string | null; onSelect: (id: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <KeywordRangePicker
      keywords={keywords}
      selectedKeywordId={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect(id);
      }}
    />
  );
}

describe('KeywordRangePicker', () => {
  it('木と「科目全体」を表示し、初期状態では科目全体が選択されている', () => {
    render(<Harness onSelect={() => {}} />);
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: '科目全体' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('treeitem', { name: 'ネットワーク' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('treeitem', { name: 'ネットワーク' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('treeitem', { name: 'ネットワーク' })).toHaveAttribute('aria-level', '1');
  });

  it('途中ノードを選ぶと範囲として通知し、aria-selected に反映する', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);
    await user.click(within(screen.getByRole('treeitem', { name: 'ネットワーク' })).getByText('▸'));
    const mid = screen.getByRole('treeitem', { name: 'TCP/IP' });
    expect(mid).toHaveAttribute('aria-level', '2');
    await user.click(mid);
    expect(onSelect).toHaveBeenLastCalledWith('a1');
    expect(screen.getByRole('treeitem', { name: 'TCP/IP' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('treeitem', { name: '科目全体' })).toHaveAttribute('aria-selected', 'false');
  });

  it('「科目全体」を選ぶと null を通知する', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial="b" onSelect={onSelect} />);
    expect(screen.getByRole('treeitem', { name: 'データベース' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('treeitem', { name: '科目全体' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('treeitem', { name: '科目全体' })).toHaveAttribute('aria-selected', 'true');
  });

  it('初期選択が深いノードなら祖先を展開して表示する', () => {
    render(<Harness initial="a1x" onSelect={() => {}} />);
    expect(screen.getByRole('treeitem', { name: 'TCP' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('treeitem', { name: 'TCP' })).toHaveAttribute('tabindex', '0');
  });

  it('矢印キーで移動・展開・折りたたみし、Enter で選択する', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);
    const all = screen.getByRole('treeitem', { name: '科目全体' });
    expect(all).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(all).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    const net = screen.getByRole('treeitem', { name: 'ネットワーク' });
    expect(net).toHaveFocus();
    expect(net).toHaveAttribute('tabindex', '0');
    expect(all).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowRight}');
    expect(net).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: 'TCP/IP' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('a1');
    await user.keyboard('{ArrowLeft}');
    expect(net).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(net).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{End}');
    expect(screen.getByRole('treeitem', { name: 'データベース' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(all).toHaveFocus();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

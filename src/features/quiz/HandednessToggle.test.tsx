// 配置の切り替え: 選択中の表示と、クリック・キーボードでの切り替え（11.1、11.8）
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HandednessToggle } from './HandednessToggle';
import { DEFAULT_HANDEDNESS } from './handedness';

describe('HandednessToggle', () => {
  it('初期値の「右手用」が選択中で、グループに名前がある', () => {
    render(<HandednessToggle value={DEFAULT_HANDEDNESS} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: '操作の配置' })).toBeInTheDocument();
    const right = screen.getByRole('button', { name: '右手用' });
    const left = screen.getByRole('button', { name: '左手用' });
    expect(right).toHaveAttribute('aria-pressed', 'true');
    expect(left).toHaveAttribute('aria-pressed', 'false');
    expect(right).toHaveClass('tap-target', 'focus-ring', 'choice-selected');
    expect(left).toHaveClass('tap-target', 'focus-ring');
    expect(left).not.toHaveClass('choice-selected');
  });

  it('左手用が選択中なら「左手用」が aria-pressed="true"', () => {
    render(<HandednessToggle value="left" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '左手用' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '右手用' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('クリックで onChange を呼ぶ', async () => {
    const onChange = vi.fn();
    render(<HandednessToggle value="right" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '左手用' }));
    expect(onChange).toHaveBeenCalledWith('left');
  });

  it('Enter と Space で onChange を呼ぶ', async () => {
    const onChange = vi.fn();
    render(<HandednessToggle value="left" onChange={onChange} />);
    screen.getByRole('button', { name: '右手用' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('right');
    onChange.mockClear();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('right');
  });
});

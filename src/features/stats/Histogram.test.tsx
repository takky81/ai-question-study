// 横棒ヒストグラム: 全区間のラベルと件数、0 件の無効化、選択、未出題の位置、色トークン（2.5、4.4、4.5、5.8、7.4、7.5）
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildHistograms } from './bins';
import { Histogram } from './Histogram';

const rate = buildHistograms([
  { target: 'question', metric: 'correctRate', bin: -1, itemCount: 3 },
  { target: 'question', metric: 'correctRate', bin: 6, itemCount: 12 },
  { target: 'question', metric: 'correctRate', bin: 9, itemCount: 1 },
]).question.correctRate;
const count = buildHistograms([
  { target: 'question', metric: 'attemptCount', bin: 0, itemCount: 2 },
  { target: 'question', metric: 'attemptCount', bin: 3, itemCount: 5 },
]).question.attemptCount;

describe('Histogram', () => {
  it('正答率の全区間のラベルと件数、範囲と件数の aria-label を表示する', () => {
    render(<Histogram title="正答率の分布" histogram={rate} unit="問" selectedBin={null} onSelect={() => {}} />);
    expect(screen.getByRole('heading', { name: '正答率の分布' })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(11);
    expect(buttons[0]).toHaveTextContent('0〜10%0');
    expect(screen.getByRole('button', { name: '正答率 60%以上70%未満: 12問' })).toHaveTextContent('60〜70%12');
    expect(screen.getByRole('button', { name: '正答率 90%以上100%以下: 1問' })).toBeInTheDocument();
  });

  it('未出題の行は区切りの後の最後に置く', () => {
    render(<Histogram title="正答率の分布" histogram={rate} unit="問" selectedBin={null} onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const last = buttons[buttons.length - 1]!;
    expect(last).toHaveAccessibleName('正答率 未出題: 3問');
    expect(last).toHaveTextContent('未出題3');
    const separator = screen.getByRole('separator');
    expect(separator.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator.compareDocumentPosition(buttons[9]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('出題回数は 0 から最大の区間までを表示し、未出題の行を持たない', () => {
    render(
      <Histogram title="出題回数の分布" histogram={count} unit="キーワード" selectedBin={null} onSelect={() => {}} />,
    );
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      '出題 0回: 2キーワード',
      '出題 1回: 0キーワード',
      '出題 2回以上3回以下: 0キーワード',
      '出題 4回以上7回以下: 5キーワード',
    ]);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('0 件の行は選べない', async () => {
    const onSelect = vi.fn();
    render(<Histogram title="t" histogram={rate} unit="問" selectedBin={null} onSelect={onSelect} />);
    const zero = screen.getByRole('button', { name: '正答率 0%以上10%未満: 0問' });
    expect(zero).toBeDisabled();
    await userEvent.click(zero);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('選択を通知し、選択中の行は aria-pressed と太字で示す', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <Histogram title="t" histogram={rate} unit="問" selectedBin={null} onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^正答率 未出題/ }));
    expect(onSelect).toHaveBeenCalledWith(-1);
    rerender(<Histogram title="t" histogram={rate} unit="問" selectedBin={6} onSelect={onSelect} />);
    const selected = screen.getByRole('button', { name: /^正答率 60%以上/ });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveClass('font-bold');
    expect(screen.getByRole('button', { name: /^正答率 90%以上/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('44px の操作領域とフォーカス表示を持ち、正誤・警告系の class を使わない', () => {
    const { container } = render(
      <Histogram title="t" histogram={rate} unit="問" selectedBin={6} onSelect={() => {}} />,
    );
    for (const b of screen.getAllByRole('button')) expect(b).toHaveClass('tap-target', 'focus-ring');
    const classes = [...container.querySelectorAll('[class]')].map((el) => el.getAttribute('class')).join(' ');
    expect(classes).not.toMatch(/correct|incorrect|warn/);
  });
});

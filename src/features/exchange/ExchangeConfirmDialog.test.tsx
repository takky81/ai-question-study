// 破棄・離脱の確認ダイアログ: 初期フォーカス、Esc、フォーカスの復帰（10.4、10.6）
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExchangeConfirmDialog } from './ExchangeConfirmDialog';

function Harness({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>開く</button>
      <ExchangeConfirmDialog open={open} onConfirm={onConfirm} onCancel={() => setOpen(false)} />
    </>
  );
}

describe('ExchangeConfirmDialog', () => {
  it('開くとキャンセルへフォーカスし、名前と説明を持つ', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    const dialog = screen.getByRole('dialog', { name: '取込の内容を破棄しますか' });
    expect(dialog).toHaveAccessibleDescription(/破棄して移動します/);
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus();
  });

  it('Esc で閉じ、開く前の要素へフォーカスを戻す', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開く' })).toHaveFocus();
  });

  it('確定で onConfirm を呼ぶ', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    await user.click(screen.getByRole('button', { name: '破棄して移動' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

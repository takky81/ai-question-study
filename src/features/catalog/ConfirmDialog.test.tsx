// 確認ダイアログ: 初期フォーカス、Esc、確定、二重押下防止、フォーカスの復帰
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function Harness({ onConfirm, busy = false }: { onConfirm: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        開く
      </button>
      <ConfirmDialog
        open={open}
        title="科目を削除"
        message="キーワード 3 件、問題 5 件"
        confirmLabel="削除する"
        danger
        busy={busy}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('開くと確定以外のボタンにフォーカスし、警告色の確定ボタンを持つ', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    expect(screen.getByRole('dialog', { name: '科目を削除' })).toBeInTheDocument();
    expect(screen.getByText('キーワード 3 件、問題 5 件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '削除する' }).className).toContain('bg-warn');
  });

  it('Esc で閉じ、開いたボタンへフォーカスを戻す', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);
    const opener = screen.getByRole('button', { name: '開く' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('確定ボタンで onConfirm を呼ぶ', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    await user.click(screen.getByRole('button', { name: '削除する' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('処理中は確定ボタンを無効にする', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} busy />);
    await user.click(screen.getByRole('button', { name: '開く' }));
    const confirm = screen.getByRole('button', { name: '削除する' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

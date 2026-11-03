// フラグ入力: 表示名・初期の選択済み・保存中の無効化・失敗時の入力保持（7.1、7.3、7.6、7.7、10.3）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FlagForm } from './FlagForm';
import { QUESTION_FLAGS } from './flags';

describe('FlagForm', () => {
  it('フラグ定義の表示名でチェックボックス4つと自由入力欄を表示する', () => {
    render(<FlagForm initialFlags={[]} initialComment={null} onSave={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    for (const f of QUESTION_FLAGS) {
      expect(screen.getByLabelText(f.label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('疑義の内容（自由入力）').tagName).toBe('TEXTAREA');
  });

  it('未解消フラグ（guessable を含む）とコメントで初期化する', () => {
    render(<FlagForm initialFlags={['guessable', 'defective']} initialComment="既存" onSave={vi.fn()} />);
    expect(screen.getByLabelText('知識がなくても推測で解ける')).toBeChecked();
    expect(screen.getByLabelText('問題不備（正解・問題文の誤り、正解が一つに決まらない）')).toBeChecked();
    expect(screen.getByLabelText('問う価値が低い')).not.toBeChecked();
    expect(screen.getByLabelText('疑義の内容（自由入力）')).toHaveValue('既存');
  });

  it('選択内容とコメントで保存し、保存中は送信を無効にする', async () => {
    let resolve!: () => void;
    const onSave = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<FlagForm initialFlags={['guessable']} initialComment={null} onSave={onSave} />);
    await user.click(screen.getByLabelText('問う価値が低い'));
    await user.click(screen.getByLabelText('知識がなくても推測で解ける'));
    await user.type(screen.getByLabelText('疑義の内容（自由入力）'), 'メモ');
    await user.click(screen.getByRole('button', { name: 'フラグを保存' }));
    expect(onSave).toHaveBeenCalledWith(['low_value'], 'メモ');
    expect(screen.getByRole('button', { name: /保存/ })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'フラグを保存' })).toBeEnabled());
    expect(screen.getByRole('status')).toHaveTextContent('保存しました');
  });

  it('保存に失敗したら入力を保持し、失敗と再試行を表示する', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('フラグの保存に失敗しました: x')).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<FlagForm initialFlags={[]} initialComment={null} onSave={onSave} />);
    await user.click(screen.getByLabelText('解説の内容を追加する'));
    await user.type(screen.getByLabelText('疑義の内容（自由入力）'), '残る');
    await user.click(screen.getByRole('button', { name: 'フラグを保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('フラグの保存に失敗しました: x');
    expect(screen.getByLabelText('解説の内容を追加する')).toBeChecked();
    expect(screen.getByLabelText('疑義の内容（自由入力）')).toHaveValue('残る');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(onSave).toHaveBeenLastCalledWith(['needs_explanation'], '残る');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

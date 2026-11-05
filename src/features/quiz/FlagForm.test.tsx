// フラグ入力: 表示名・初期の選択済み・自動保存の要求・状態表示・失敗時の入力保持（7.1〜7.7、7.9、7.10、10.3）
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { FlagSaveStatus } from './flagAutosave';
import { FlagForm } from './FlagForm';
import { QUESTION_FLAGS, type CheckboxFlagId } from './flags';

const COMMENT = '疑義の内容（自由入力）';

function setup(
  over: Partial<{ initialFlags: CheckboxFlagId[]; initialComment: string | null; status: FlagSaveStatus }> = {},
) {
  const props = {
    initialFlags: over.initialFlags ?? [],
    initialComment: over.initialComment ?? null,
    status: over.status ?? ({ kind: 'idle' } as FlagSaveStatus),
    onChangeFlags: vi.fn(),
    onCommitComment: vi.fn(),
    onRetry: vi.fn(),
  };
  const utils = render(<FlagForm {...props} />);
  return { ...utils, props };
}

describe('FlagForm', () => {
  it('フラグ定義の表示名でチェックボックス4つと自由入力欄を表示する', () => {
    setup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    for (const f of QUESTION_FLAGS) {
      expect(screen.getByLabelText(f.label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(COMMENT).tagName).toBe('TEXTAREA');
  });

  it('未解消フラグ（guessable を含む）とコメントで初期化する', () => {
    setup({ initialFlags: ['guessable', 'defective'], initialComment: '既存' });
    expect(screen.getByLabelText('知識がなくても推測で解ける')).toBeChecked();
    expect(screen.getByLabelText('問題不備（正解・問題文の誤り、正解が一つに決まらない）')).toBeChecked();
    expect(screen.getByLabelText('問う価値が低い')).not.toBeChecked();
    expect(screen.getByLabelText(COMMENT)).toHaveValue('既存');
  });

  it('チェックの変更ごとに変更後の集合で onChangeFlags を呼ぶ（保存中も操作できる）', async () => {
    const user = userEvent.setup();
    const { props } = setup({ initialFlags: ['guessable'], status: { kind: 'saving' } });
    await user.click(screen.getByLabelText('問う価値が低い'));
    expect(props.onChangeFlags).toHaveBeenLastCalledWith(['guessable', 'low_value']);
    await user.click(screen.getByLabelText('知識がなくても推測で解ける'));
    expect(props.onChangeFlags).toHaveBeenLastCalledWith(['low_value']);
    expect(props.onChangeFlags).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('知識がなくても推測で解ける')).not.toBeChecked();
  });

  it('入力中は onCommitComment を呼ばず、blur で入力値を渡す', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.type(screen.getByLabelText(COMMENT), 'メモ');
    expect(props.onCommitComment).not.toHaveBeenCalled();
    await user.tab();
    expect(props.onCommitComment).toHaveBeenCalledWith('メモ');
  });

  it('保存ボタンも form の submit もなく、Enter で送信しない', async () => {
    const user = userEvent.setup();
    const { props, container } = setup();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('form')).toBeNull();
    screen.getByLabelText('問う価値が低い').focus();
    await user.keyboard('{Enter}');
    expect(props.onCommitComment).not.toHaveBeenCalled();
    expect(props.onChangeFlags).not.toHaveBeenCalled();
  });

  it('saving と saved を role="status" に出し、idle では空にする', () => {
    const { rerender, props } = setup();
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<FlagForm {...props} status={{ kind: 'saving' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('保存中…');
    rerender(<FlagForm {...props} status={{ kind: 'saved' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('保存しました');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('failed では入力を保持して role="alert" と再試行を出し、再試行で onRetry を呼ぶ', async () => {
    const user = userEvent.setup();
    const { rerender, props } = setup();
    await user.click(screen.getByLabelText('解説の内容を追加する'));
    await user.type(screen.getByLabelText(COMMENT), '残る');
    fireEvent.blur(screen.getByLabelText(COMMENT));
    rerender(<FlagForm {...props} status={{ kind: 'failed', message: 'フラグの保存に失敗しました: x' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('フラグの保存に失敗しました: x');
    expect(screen.getByLabelText('解説の内容を追加する')).toBeChecked();
    expect(screen.getByLabelText(COMMENT)).toHaveValue('残る');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});

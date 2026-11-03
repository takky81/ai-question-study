// 選択肢一覧: 選択領域と「？」エリア、固定の「わからない」、判定後の正誤・解説・無効化（4.1、4.3、4.6、4.7、5.1〜5.5、5.7、5.8）
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceList, choiceDisplayState } from './ChoiceList';
import type { QuizChoice } from './types';

const choices: QuizChoice[] = [
  { id: 'a', body: '選択肢A', explanation: 'Aの解説', isCorrect: true },
  { id: 'b', body: '選択肢B', explanation: 'Bの解説', isCorrect: false },
];

function item(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement;
}

describe('choiceDisplayState', () => {
  it('判定前は印も選択も出さない', () => {
    expect(choiceDisplayState('a', { choiceId: 'a' }, null)).toEqual({ selected: false, mark: null });
  });
  it('正解・選んだ不正解・わからない', () => {
    expect(choiceDisplayState('a', { choiceId: 'b' }, 'a')).toEqual({ selected: false, mark: 'correct' });
    expect(choiceDisplayState('b', { choiceId: 'b' }, 'a')).toEqual({ selected: true, mark: 'incorrect' });
    expect(choiceDisplayState(null, { choiceId: null }, 'a')).toEqual({ selected: true, mark: 'incorrect' });
    expect(choiceDisplayState(null, { choiceId: 'a' }, 'a')).toEqual({ selected: false, mark: null });
  });
});

describe('ChoiceList', () => {
  it('判定前: 選択領域・「？」エリア・「わからない」を出し、印と解説を出さない', async () => {
    const onAnswer = vi.fn();
    render(<ChoiceList choices={choices} selection={null} correctChoiceId={null} onAnswer={onAnswer} />);
    const guess = screen.getByRole('button', { name: '推測で解答: 選択肢A' });
    expect(guess).toHaveClass('tap-target');
    expect(screen.getAllByRole('button', { name: /^推測で解答/ })).toHaveLength(2);
    const unknown = item('わからない');
    expect(within(unknown).queryByRole('button', { name: /推測/ })).toBeNull();
    expect(screen.queryByText('Aの解説')).toBeNull();
    expect(screen.queryByText('正解')).toBeNull();
    expect(document.querySelector('.mark-correct, .mark-incorrect, .choice-selected')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^選択肢B/ }));
    await user.click(guess);
    await user.click(screen.getByRole('button', { name: /^わからない/ }));
    expect(onAnswer.mock.calls).toEqual([
      ['normal', 'b'],
      ['guess', 'a'],
      ['unknown', null],
    ]);
  });

  it('キーボードで選択領域を操作できる', async () => {
    const onAnswer = vi.fn();
    render(<ChoiceList choices={choices} selection={null} correctChoiceId={null} onAnswer={onAnswer} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: /^選択肢A/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onAnswer).toHaveBeenCalledWith('normal', 'a');
  });

  it('正解時: 選択と正解の印を同じ選択肢に出し、解説を表示し、無効化する', () => {
    render(<ChoiceList choices={choices} selection={{ choiceId: 'a' }} correctChoiceId="a" onAnswer={vi.fn()} />);
    const a = item('選択肢A');
    expect(a).toHaveClass('choice-selected', 'mark-correct');
    expect(within(a).getByText('正解')).toBeInTheDocument();
    expect(within(a).getByText('選択した解答')).toBeInTheDocument();
    expect(within(a).getByText('Aの解説')).toBeInTheDocument();
    expect(within(item('選択肢B')).getByText('Bの解説')).toBeInTheDocument();
    expect(item('選択肢B')).not.toHaveClass('mark-correct', 'mark-incorrect', 'choice-selected');
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('誤答時: 選んだ不正解に誤答の印、正解に正解の印', () => {
    render(<ChoiceList choices={choices} selection={{ choiceId: 'b' }} correctChoiceId="a" onAnswer={vi.fn()} />);
    const b = item('選択肢B');
    expect(b).toHaveClass('choice-selected', 'mark-incorrect');
    expect(within(b).getByText('不正解')).toBeInTheDocument();
    expect(item('選択肢A')).toHaveClass('mark-correct');
    expect(item('選択肢A')).not.toHaveClass('choice-selected');
  });

  it('「わからない」時: 「わからない」に選択と誤答の印、正解に正解の印', () => {
    render(<ChoiceList choices={choices} selection={{ choiceId: null }} correctChoiceId="a" onAnswer={vi.fn()} />);
    const u = item('わからない');
    expect(u).toHaveClass('choice-selected', 'mark-incorrect');
    expect(within(u).getByText('不正解')).toBeInTheDocument();
    expect(item('選択肢A')).toHaveClass('mark-correct');
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('disabled 指定で判定前も操作不可', () => {
    render(<ChoiceList choices={choices} selection={null} correctChoiceId={null} disabled onAnswer={vi.fn()} />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});

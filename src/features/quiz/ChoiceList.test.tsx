// 選択肢一覧: 選択領域と「？」エリア、固定の「わからない」、判定後の正誤・解説・無効化（4.1、4.3、4.6、4.7、5.1〜5.5、5.7〜5.9）
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

function cellOf(li: HTMLElement) {
  return li.querySelector('[data-testid="mark-cell"]') as HTMLElement;
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

  it('判定後: 「？」ボタンをなくし、同じ右端の列に正解は ○、選んだ不正解は ×、それ以外は空の印セルを置く', () => {
    render(<ChoiceList choices={choices} selection={{ choiceId: 'b' }} correctChoiceId="a" onAnswer={vi.fn()} />);
    expect(screen.queryAllByRole('button', { name: /^推測で解答/ })).toHaveLength(0);
    const a = cellOf(item('選択肢A'));
    const b = cellOf(item('選択肢B'));
    expect(a.tagName).toBe('SPAN');
    expect(within(a).getByText('正解')).toBeInTheDocument();
    expect(a).toHaveClass('w-11', 'border-l', 'text-correct');
    expect(within(b).getByText('不正解')).toBeInTheDocument();
    expect(b).toHaveClass('w-11', 'border-l', 'text-incorrect');
    // 選ばなかった「わからない」には印セルを置かない
    expect(cellOf(item('わからない'))).toBeNull();
    // 印は右端の列だけに出る
    expect(screen.getAllByText('正解')).toHaveLength(1);
    expect(screen.getAllByText('不正解')).toHaveLength(1);
    expect(document.querySelector('[class*="warn"]')).toBeNull();
  });

  it('判定後: 印なしの選択肢も幅を保った空の印セルを持ち、判定前の「？」と同じ幅', () => {
    const { rerender } = render(
      <ChoiceList choices={choices} selection={null} correctChoiceId={null} onAnswer={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '推測で解答: 選択肢B' })).toHaveClass('w-11', 'border-l');
    rerender(<ChoiceList choices={choices} selection={{ choiceId: 'a' }} correctChoiceId="a" onAnswer={vi.fn()} />);
    const b = cellOf(item('選択肢B'));
    expect(b).toHaveClass('w-11', 'border-l');
    expect(b).toHaveTextContent('');
    expect(screen.queryByText('不正解')).toBeNull();
  });

  it('「わからない」を選んだ判定後: 「わからない」の行に × の印セルを置く', () => {
    render(<ChoiceList choices={choices} selection={{ choiceId: null }} correctChoiceId="a" onAnswer={vi.fn()} />);
    const cell = cellOf(item('わからない'));
    expect(within(cell).getByText('不正解')).toBeInTheDocument();
    expect(cell).toHaveClass('w-11', 'border-l');
  });

  it('disabled 指定で判定前も操作不可', () => {
    render(<ChoiceList choices={choices} selection={null} correctChoiceId={null} disabled onAnswer={vi.fn()} />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});

// 成績表示（6.1〜6.3）と正誤による色分け（12.1、12.2、12.4、12.5、12.7、12.8、12.9）
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuestionStatsBar } from './QuestionStatsBar';
import { applyAnswerToStats } from './stats';
import type { QuestionStats } from './types';

const empty: QuestionStats = { attemptCount: 0, correctCount: 0, correctRate: null, retention: null, lastAnsweredAt: null };

describe('QuestionStatsBar', () => {
  it('出題数 0 は「未出題」と表示する', () => {
    render(<QuestionStatsBar stats={empty} />);
    expect(screen.getByText('正答 0 / 出題 0（未出題）')).toBeInTheDocument();
  });

  it('判定後の更新値を表示する', () => {
    const { rerender } = render(<QuestionStatsBar stats={{ ...empty, attemptCount: 4, correctCount: 2, correctRate: 0.5 }} />);
    expect(screen.getByText('正答 2 / 出題 4（50%）')).toBeInTheDocument();
    rerender(<QuestionStatsBar stats={applyAnswerToStats({ ...empty, attemptCount: 4, correctCount: 2, correctRate: 0.5 }, true)} />);
    expect(screen.getByText('正答 3 / 出題 5（60%）')).toBeInTheDocument();
  });

  it('判定前（outcome が null）は正誤の文字を出さず、透明の枠で場所を確保する', () => {
    render(<QuestionStatsBar stats={empty} outcome={null} />);
    const bar = screen.getByText('正答 0 / 出題 0（未出題）', { exact: false });
    expect(bar).toHaveClass('rounded', 'border-2', 'px-2', 'py-1', 'border-transparent', 'text-text-muted');
    expect(bar).not.toHaveClass('mark-correct', 'mark-incorrect');
    expect(screen.queryByText('○ 正解')).not.toBeInTheDocument();
    expect(screen.queryByText('× 不正解')).not.toBeInTheDocument();
    const mark = bar.querySelector('span');
    expect(mark).toHaveClass('inline-block', 'w-[5em]', 'font-bold');
    expect(mark).toHaveTextContent('');
  });

  it('正解のときは正解の色と「○ 正解」を出す', () => {
    render(<QuestionStatsBar stats={{ ...empty, attemptCount: 1, correctCount: 1, correctRate: 1 }} outcome="correct" />);
    const mark = screen.getByText('○ 正解');
    expect(mark).toHaveClass('inline-block', 'w-[5em]', 'font-bold');
    const bar = mark.parentElement;
    expect(bar).toHaveClass('rounded', 'border-2', 'px-2', 'py-1', 'mark-correct', 'border-correct');
    expect(bar).not.toHaveClass('border-transparent', 'text-text-muted');
    expect(bar).toHaveTextContent('正答 1 / 出題 1（100%）');
    expect(bar).toHaveAttribute('aria-live', 'polite');
  });

  it('不正解のときは不正解の色と「× 不正解」を出す', () => {
    render(<QuestionStatsBar stats={{ ...empty, attemptCount: 1, correctCount: 0, correctRate: 0 }} outcome="incorrect" />);
    const mark = screen.getByText('× 不正解');
    expect(mark).toHaveClass('inline-block', 'w-[5em]', 'font-bold');
    const bar = mark.parentElement;
    expect(bar).toHaveClass('rounded', 'border-2', 'px-2', 'py-1', 'mark-incorrect', 'border-incorrect');
    expect(bar).not.toHaveClass('border-transparent', 'text-text-muted', 'mark-correct');
    expect(bar).toHaveTextContent('正答 0 / 出題 1（0%）');
  });
});

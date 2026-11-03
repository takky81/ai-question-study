// 成績表示（6.1〜6.3）
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
});

// 終了表示（2.5）
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { SessionSummary } from './SessionSummary';

const S = '00000000-0000-4000-8000-000000000001';
const K = '00000000-0000-4000-8000-000000000002';

describe('SessionSummary', () => {
  it('解答数・正答数と範囲付きの戻る導線を表示する', () => {
    render(
      <MemoryRouter>
        <SessionSummary answeredCount={5} correctCount={3} range={{ subjectId: S, keywordId: K }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('5 問解答、正答 3 問')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '範囲選択へ戻る' })).toHaveAttribute('href', `/quiz?subject=${S}&keyword=${K}`);
  });

  it('科目全体の範囲では keyword を含めない', () => {
    render(
      <MemoryRouter>
        <SessionSummary answeredCount={0} correctCount={0} range={{ subjectId: S, keywordId: null }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '範囲選択へ戻る' })).toHaveAttribute('href', `/quiz?subject=${S}`);
  });
});

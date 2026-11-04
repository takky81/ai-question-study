// 科目と範囲の選択: 選択肢の表示（字下げ）と変更の通知（1.2、1.3、7.2）
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { KeywordNode } from '@/lib/keywordTree';

import { RangeSelector } from './RangeSelector';

const subjects = [
  { id: 's1', name: '科目A', createdAt: '2026-01-01T00:00:00Z' },
  { id: 's2', name: '科目B', createdAt: '2026-01-02T00:00:00Z' },
];
const keywords: KeywordNode[] = [
  { id: 'k1', parentId: null, name: '親', sortOrder: 0 },
  { id: 'k2', parentId: 'k1', name: '子', sortOrder: 0 },
];

function setup(keywordId: string | null = null) {
  const onSubjectChange = vi.fn();
  const onKeywordChange = vi.fn();
  render(
    <RangeSelector
      subjects={subjects}
      subjectId="s1"
      keywords={keywords}
      keywordId={keywordId}
      onSubjectChange={onSubjectChange}
      onKeywordChange={onKeywordChange}
    />,
  );
  return { onSubjectChange, onKeywordChange };
}

describe('RangeSelector', () => {
  it('科目と、科目全体を先頭にした字下げ付きの範囲の選択肢を表示する', () => {
    setup('k2');
    const subject = screen.getByLabelText('科目');
    expect(subject).toHaveValue('s1');
    expect([...subject.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['科目A', '科目B']);
    const range = screen.getByLabelText('範囲');
    expect(range).toHaveValue('k2');
    expect([...range.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['科目全体', '親', '　　子']);
    for (const el of [subject, range]) expect(el).toHaveClass('focus-ring', 'tap-target', 'w-full');
  });

  it('変更を親へ通知し、科目全体は null で通知する', async () => {
    const { onSubjectChange, onKeywordChange } = setup('k1');
    await userEvent.selectOptions(screen.getByLabelText('科目'), 's2');
    expect(onSubjectChange).toHaveBeenCalledWith('s2');
    await userEvent.selectOptions(screen.getByLabelText('範囲'), 'k2');
    expect(onKeywordChange).toHaveBeenCalledWith('k2');
    await userEvent.selectOptions(screen.getByLabelText('範囲'), '科目全体');
    expect(onKeywordChange).toHaveBeenLastCalledWith(null);
  });
});

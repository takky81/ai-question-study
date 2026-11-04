// 掘り下げの一覧: 設問・キーワードの行、編集画面へのリンク、未出題、見出し、閉じる（5.2、5.3、5.6、5.7、5.9）
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { KeywordNode } from '@/lib/keywordTree';

import { BinItemList } from './BinItemList';
import type { BinItem } from './types';

const keywords: KeywordNode[] = [
  { id: 'k1', parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: 'k2', parentId: 'k1', name: 'TCP', sortOrder: 0 },
];

const item = (over: Partial<BinItem>): BinItem => ({
  itemId: 'q1',
  attemptCount: 5,
  correctCount: 3,
  correctRate: 0.6,
  questionCount: null,
  stem: '問題文',
  ...over,
});

function renderList(props: Partial<Parameters<typeof BinItemList>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <BinItemList
        target="question"
        title="正答率 60〜70% の設問"
        items={[item({})]}
        subjectId="s1"
        keywords={keywords}
        onClose={onClose}
        {...props}
      />
    </MemoryRouter>,
  );
  return onClose;
}

describe('BinItemList', () => {
  it('見出しに区間と件数を表示する', () => {
    renderList({ items: [item({}), item({ itemId: 'q2' })] });
    const heading = screen.getByRole('heading');
    expect(heading).toHaveTextContent('正答率 60〜70% の設問');
    expect(heading).toHaveTextContent('2件');
  });

  it('設問の行は問題文の冒頭と成績を表示し、編集画面へリンクする', () => {
    renderList({ items: [item({ stem: 'あ'.repeat(100) })] });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/catalog/s1/questions/q1');
    expect(link).toHaveTextContent(`${'あ'.repeat(80)}…`);
    expect(link).toHaveTextContent('正答 3 / 出題 5（60%）');
    expect(link).toHaveClass('focus-ring', 'tap-target', 'min-w-0', 'break-words');
  });

  it('未出題の設問は「未出題」と表示する', () => {
    renderList({ items: [item({ attemptCount: 0, correctCount: 0, correctRate: null })] });
    expect(screen.getByRole('link')).toHaveTextContent('正答 0 / 出題 0（未出題）');
  });

  it('キーワードの行は階層パス、問題数、成績を表示し、リンクにしない', () => {
    renderList({
      target: 'keyword',
      items: [
        item({ itemId: 'k2', stem: null, questionCount: 4, attemptCount: 10, correctCount: 9, correctRate: 0.9 }),
      ],
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('ネットワーク / TCP');
    expect(row).toHaveTextContent('問題 4 問');
    expect(row).toHaveTextContent('正答 9 / 出題 10（90%）');
  });

  it('閉じるボタンで通知する', async () => {
    const onClose = renderList();
    const close = screen.getByRole('button', { name: '閉じる' });
    expect(close).toHaveClass('focus-ring', 'tap-target');
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

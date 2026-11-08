// 判定後の解説とキーワードの階層パス（5.5〜5.7）
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { KeywordNode } from '@/lib/keywordTree';

import { AnswerFeedback } from './AnswerFeedback';

const keywords: KeywordNode[] = [
  { id: 'r', parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: 'c', parentId: 'r', name: 'TCP', sortOrder: 0 },
  { id: 'x', parentId: null, name: 'セキュリティ', sortOrder: 1 },
];

describe('AnswerFeedback', () => {
  it('判定前は何も描画しない', () => {
    const { container } = render(<AnswerFeedback judged={false} explanation="解説" keywordIds={['c']} keywords={keywords} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('判定後に解説と各キーワードの階層パスを表示する', () => {
    render(<AnswerFeedback judged explanation="問題の解説" keywordIds={['c', 'x']} keywords={keywords} />);
    expect(screen.getByText('問題の解説')).toBeInTheDocument();
    expect(screen.getByText('ネットワーク / TCP')).toBeInTheDocument();
    expect(screen.getByText('セキュリティ')).toBeInTheDocument();
  });

  it('見つからないキーワードは表示しない', () => {
    render(<AnswerFeedback judged explanation="" keywordIds={['missing']} keywords={keywords} />);
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('空白だけの解説は段落を出さず、キーワードがあれば枠に階層パスだけを出す', () => {
    const { container } = render(<AnswerFeedback judged explanation={'  \n '} keywordIds={['c']} keywords={keywords} />);
    expect(container.querySelector('p')).toBeNull();
    expect(screen.getByRole('region', { name: '解説' })).toBeInTheDocument();
    expect(screen.getByText('ネットワーク / TCP')).toBeInTheDocument();
  });

  it('解説が空でキーワードの階層パスもないときは解説の枠を描画しない', () => {
    const { container } = render(<AnswerFeedback judged explanation=" " keywordIds={['missing']} keywords={keywords} />);
    expect(container).toBeEmptyDOMElement();
  });
});

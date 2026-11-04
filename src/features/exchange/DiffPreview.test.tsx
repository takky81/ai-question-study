// 差分プレビュー（5.1〜5.7、10.2、10.5）
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ImportDiff } from './diff';
import { DiffPreview } from './DiffPreview';
import type { SnapshotQuestion } from './importValidate';

const KEYWORDS = [
  { id: 'k1', parentId: null, name: 'ネットワーク', sortOrder: 0 },
  { id: 'k2', parentId: 'k1', name: 'TCP', sortOrder: 0 },
  { id: 'k3', parentId: null, name: 'DB', sortOrder: 1 },
];

const before: SnapshotQuestion = {
  id: 'q1',
  subjectId: 's1',
  kind: 'keyword',
  stem: '旧い問題文',
  explanation: '同じ解説',
  keywordIds: ['k2'],
  choices: [
    { id: 'c1', body: '選択肢A', explanation: 'eA', isCorrect: true },
    { id: 'c2', body: '選択肢B', explanation: 'eB', isCorrect: false },
    { id: 'c3', body: '消える選択肢', explanation: 'eC', isCorrect: false },
  ],
  status: 'active',
  updatedAt: '2026-01-01T00:00:00Z',
};

const DIFF: ImportDiff = {
  keywords: [
    { type: 'added', tempKey: 'n1', afterPath: ['ネットワーク', 'UDP'] },
    { type: 'renamed', id: 'k3', beforePath: ['DB'], afterPath: ['データベース'] },
    { type: 'moved', id: 'k2', beforePath: ['ネットワーク', 'TCP'], afterPath: ['データベース', 'TCP'] },
  ],
  updated: [
    {
      id: 'q1',
      fields: ['stem'],
      choices: [
        {
          type: 'changed',
          id: 'c2',
          fields: ['body'],
          before: before.choices[1]!,
          after: { id: 'c2', body: '選択肢B改', explanation: 'eB', isCorrect: false },
        },
        { type: 'removed', before: before.choices[2]! },
        { type: 'added', index: 2, after: { body: '新しい選択肢', explanation: 'eD', isCorrect: false } },
        { type: 'moved', id: 'c1', fromIndex: 0, toIndex: 1 },
      ],
      before,
      after: {
        kind: 'keyword',
        stem: '新しい問題文',
        explanation: '同じ解説',
        keywords: [{ id: 'k2' }],
        choices: [
          { id: 'c2', body: '選択肢B改', explanation: 'eB', isCorrect: false },
          { id: 'c1', body: '選択肢A', explanation: 'eA', isCorrect: true },
          { body: '新しい選択肢', explanation: 'eD', isCorrect: false },
        ],
      },
      afterKeywordPaths: [['データベース', 'TCP']],
      flagsToResolve: [{ flag: 'defective', note: '正解が曖昧', createdAt: '2026-01-02T00:00:00Z' }],
      updatedSinceExport: true,
    },
  ],
  unchanged: ['q9'],
  created: [
    {
      index: 0,
      body: {
        kind: 'feature',
        stem: '新規の問題文',
        explanation: '新規の解説',
        keywords: [{ tempKey: 'n1' }],
        choices: [
          { body: '新規正解', explanation: 'x', isCorrect: true },
          { body: '新規誤り', explanation: 'y', isCorrect: false },
        ],
      },
      keywordPaths: [['ネットワーク', 'UDP']],
    },
  ],
  disabled: [{ id: 'q5', stem: '無効にする問題', reason: '古い制度', alreadyDisabled: false }],
  counts: {
    keywordsAdded: 1,
    keywordsRenamed: 1,
    keywordsMoved: 1,
    questionsUpdated: 1,
    questionsCreated: 1,
    questionsDisabled: 1,
  },
  warnings: [],
};

const setup = () => render(<DiffPreview diff={DIFF} keywords={KEYWORDS} />);

describe('DiffPreview', () => {
  it('件数の要約を出す', () => {
    setup();
    const summary = screen.getByRole('region', { name: '変更の件数' });
    expect(within(summary).getByText('問題の修正')).toBeInTheDocument();
    expect(within(summary).getAllByText('1')).toHaveLength(6);
  });

  it('キーワードの変更を前後の階層パスで出す', () => {
    setup();
    const kw = screen.getByRole('region', { name: 'キーワードの変更' });
    expect(within(kw).getByText('ネットワーク / UDP')).toBeInTheDocument();
    expect(within(kw).getByText('DB')).toBeInTheDocument();
    expect(within(kw).getByText('データベース')).toBeInTheDocument();
    expect(within(kw).getByText('ネットワーク / TCP')).toBeInTheDocument();
    expect(within(kw).getByText('データベース / TCP')).toBeInTheDocument();
  });

  it('修正は変わった項目だけを前後表示し、選択肢に印を付ける', () => {
    setup();
    const upd = screen.getByRole('region', { name: '問題の修正' });
    expect(within(upd).getByText('旧い問題文')).toBeInTheDocument();
    expect(within(upd).getByText('新しい問題文')).toBeInTheDocument();
    // 変わっていない解説・紐づけは前後比較に出さない
    expect(within(upd).queryByText('同じ解説')).not.toBeInTheDocument();
    expect(within(upd).queryByText('紐づくキーワード')).not.toBeInTheDocument();
    expect(within(upd).getByText('追加')).toBeInTheDocument();
    expect(within(upd).getByText('削除')).toBeInTheDocument();
    expect(within(upd).getByText('変更')).toBeInTheDocument();
    expect(within(upd).getByText('並べ替え')).toBeInTheDocument();
    expect(within(upd).getByText('消える選択肢')).toBeInTheDocument();
    expect(within(upd).getByText('新しい選択肢')).toBeInTheDocument();
    expect(within(upd).getByText('選択肢B改')).toBeInTheDocument();
    expect(within(upd).getByText('出力後に更新されています')).toBeInTheDocument();
    // 解消予定のフラグ
    expect(within(upd).getByText(/問題不備/)).toBeInTheDocument();
    expect(within(upd).getByText(/正解が曖昧/)).toBeInTheDocument();
  });

  it('正解の選択肢に共通の正解の印を付ける', () => {
    setup();
    const correct = screen.getAllByLabelText('正解');
    expect(correct.length).toBeGreaterThanOrEqual(2);
    for (const el of correct) expect(el.closest('.mark-correct')).not.toBeNull();
    expect(screen.getByText('新規正解').closest('.mark-correct')).not.toBeNull();
    expect(screen.getByText('新規誤り').closest('.mark-correct')).toBeNull();
  });

  it('新規の全内容と階層パス、無効化と理由を出す', () => {
    setup();
    const cre = screen.getByRole('region', { name: '問題の新規作成' });
    expect(within(cre).getByText('新規の問題文')).toBeInTheDocument();
    expect(within(cre).getByText('新規の解説')).toBeInTheDocument();
    expect(within(cre).getByText('ネットワーク / UDP')).toBeInTheDocument();
    const dis = screen.getByRole('region', { name: '問題の無効化' });
    expect(within(dis).getByText('無効にする問題')).toBeInTheDocument();
    expect(within(dis).getByText(/古い制度/)).toBeInTheDocument();
  });

  it('変更なしの問題を折りたたみで区別する', () => {
    setup();
    const details = screen.getByText('変更なし（1件）').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('region', { name: '問題の修正' })).not.toHaveTextContent('q9');
  });

  it('修正の紐づくキーワードは祖先の改名後の階層パスで出す（5.2）', () => {
    const q = DIFF.updated[0]!;
    const diff: ImportDiff = {
      ...DIFF,
      updated: [
        {
          ...q,
          fields: ['keywords'],
          after: { ...q.after, keywords: [{ id: 'k2' }] },
          afterKeywordPaths: [['通信', 'TCP']],
        },
      ],
    };
    render(<DiffPreview diff={diff} keywords={KEYWORDS} />);
    const upd = screen.getByRole('region', { name: '問題の修正' });
    expect(within(upd).getByText('ネットワーク / TCP')).toBeInTheDocument();
    expect(within(upd).getByText('通信 / TCP')).toBeInTheDocument();
  });
});

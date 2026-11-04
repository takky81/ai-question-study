// 出力パネル: 科目・範囲・条件の指定、件数、条件エラー、0件の案内、ダウンロード、失敗と再試行
// （1.1、1.2、1.8、1.9、1.10、2.1、2.10、10.4）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  listExportSubjects: vi.fn(),
  listSubjectKeywords: vi.fn(),
  countExportQuestions: vi.fn(),
  fetchExportRows: vi.fn(),
}));

import * as api from './api';
import { ExportPanel } from './ExportPanel';
import type { ExportRows } from './exportBuild';

const m = vi.mocked(api);

const SUBJECT = { id: 's1', name: '情報 処理' };
const KEYWORDS = [
  { id: 'k1', parentId: null, name: 'ネットワーク', sortOrder: 0, subjectId: 's1' },
  { id: 'k2', parentId: 'k1', name: 'TCP', sortOrder: 0, subjectId: 's1' },
  { id: 'k3', parentId: null, name: 'DB', sortOrder: 1, subjectId: 's1' },
];

const ROWS: ExportRows = {
  subject: { id: 's1', name: '情報 処理' },
  keywords: [],
  keywordStats: [],
  questions: [],
  choices: [],
  flags: [],
} as unknown as ExportRows;

beforeEach(() => {
  vi.clearAllMocks();
  m.listExportSubjects.mockResolvedValue([SUBJECT]);
  m.listSubjectKeywords.mockResolvedValue(KEYWORDS);
  m.countExportQuestions.mockResolvedValue(5);
});
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const user = userEvent.setup();
  render(<ExportPanel countDelayMs={0} />);
  await user.selectOptions(await screen.findByLabelText('科目'), 's1');
  await screen.findByRole('treeitem', { name: 'ネットワーク' });
  return user;
}

describe('ExportPanel', () => {
  it('科目を選ぶと木と件数が出る', async () => {
    await setup();
    expect(await screen.findByText('5 問が一致します')).toBeInTheDocument();
    expect(m.countExportQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: 's1', keywordId: null }));
  });

  it('木で範囲を選ぶと件数を取り直し、矢印キーで移動できる', async () => {
    const user = await setup();
    await user.click(screen.getByRole('treeitem', { name: 'ネットワーク' }));
    await waitFor(() =>
      expect(m.countExportQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ keywordId: 'k1' })),
    );
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: 'TCP' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('treeitem', { name: 'TCP' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('treeitem', { name: '科目全体' })).toHaveFocus();
  });

  it('条件エラーで欄の近くにエラーを出し、出力を無効にする', async () => {
    const user = await setup();
    await user.type(screen.getByLabelText('正答率の下限（%）'), '80');
    await user.type(screen.getByLabelText('正答率の上限（%）'), '20');
    expect(await screen.findByText('正答率の下限が上限を超えています')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '出力' })).toBeDisabled();
  });

  it('種類を指定でフラグ未選択はエラー', async () => {
    const user = await setup();
    await user.click(screen.getByLabelText('種類を指定'));
    expect(screen.getByText('フラグの種類を1つ以上選んでください')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '出力' })).toBeDisabled();
    await user.click(screen.getByLabelText('問う価値が低い'));
    expect(screen.queryByText('フラグの種類を1つ以上選んでください')).not.toBeInTheDocument();
  });

  it('0件の場合はキーワード階層だけの出力を案内し、出力できる', async () => {
    m.countExportQuestions.mockResolvedValue(0);
    await setup();
    expect(
      await screen.findByText('条件に一致する問題はありません。キーワード階層だけを出力できます'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '出力' })).toBeEnabled();
  });

  it('出力でファイルをダウンロードする', async () => {
    m.fetchExportRows.mockResolvedValue(ROWS);
    const createUrl = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    let downloaded = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    const user = await setup();
    await user.click(screen.getByLabelText('無効化された問題を含める'));
    await user.click(screen.getByRole('button', { name: '出力' }));
    await waitFor(() => expect(createUrl).toHaveBeenCalled());
    expect(m.fetchExportRows).toHaveBeenCalledWith(expect.objectContaining({ includeDisabled: true }));
    expect(downloaded).toMatch(/^export_情報_処理_\d{8}-\d{4}\.json$/);
    const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
    expect(JSON.parse(await blob.text())).toMatchObject({ subject: { id: 's1' }, questions: [] });
  });

  it('失敗時は警告と再試行を出す', async () => {
    m.fetchExportRows.mockRejectedValueOnce(new Error('問題の取得に失敗しました')).mockResolvedValue(ROWS);
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = await setup();
    await user.click(screen.getByRole('button', { name: '出力' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('問題の取得に失敗しました');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(m.fetchExportRows).toHaveBeenCalledTimes(2);
  });

  it('科目一覧の取得失敗で再試行を出す', async () => {
    m.listExportSubjects.mockRejectedValueOnce(new Error('科目の取得に失敗しました'));
    const user = userEvent.setup();
    render(<ExportPanel countDelayMs={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('科目の取得に失敗しました');
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('option', { name: '情報 処理' })).toBeInTheDocument();
  });
});

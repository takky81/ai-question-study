// 取込パネル: 検証から適用まで（4.1、4.11、5.9、5.10、6.6、6.7、6.8、7.3、7.4）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportSnapshot } from './importValidate';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, loadImportSnapshot: vi.fn(), applyImport: vi.fn() };
});

import { applyImport, loadImportSnapshot, StalePreviewError, type ApplyResult } from './api';
import { ImportPanel } from './ImportPanel';

const loadMock = vi.mocked(loadImportSnapshot);
const applyMock = vi.mocked(applyImport);

const question = (id: string, updatedAt = '2026-11-01T00:00:00.000Z') => ({
  id,
  subjectId: 's1',
  kind: 'feature' as const,
  stem: `問題 ${id}`,
  explanation: '解説',
  keywordIds: [],
  choices: [],
  status: 'active' as const,
  updatedAt,
});

const snapshot = (updatedAt?: string): ImportSnapshot => ({
  subject: { id: 's1', name: '科目', deleted: false },
  keywords: [],
  foreignKeywordIds: new Set(),
  questions: new Map([['q1', question('q1', updatedAt)]]),
  openFlags: new Map(),
});

const importJson = (disable: { id: string; reason: string | null }[], basedOnExportedAt: string | null = null) =>
  JSON.stringify({
    format: 'ai-question-study/import',
    version: 1,
    subjectId: 's1',
    basedOnExportedAt,
    keywords: { add: [], rename: [], move: [] },
    questions: { update: [], create: [], disable },
  });

const RESULT: ApplyResult = {
  keywordIds: {},
  questionIds: {},
  counts: { keywordsAdded: 0, keywordsRenamed: 0, keywordsMoved: 0, questionsUpdated: 2, questionsCreated: 1, questionsDisabled: 1 },
  resolvedFlagCount: 3,
};

async function choose(text: string) {
  const onHoldingChange = vi.fn();
  const user = userEvent.setup();
  render(<ImportPanel onHoldingChange={onHoldingChange} />);
  await user.upload(screen.getByLabelText('取込ファイル'), new File([text], 'import.json', { type: 'application/json' }));
  return { user, onHoldingChange };
}

beforeEach(() => {
  loadMock.mockReset();
  applyMock.mockReset();
});

describe('ImportPanel', () => {
  it('フォーマットのエラーではスナップショットを取らず、適用を出さない', async () => {
    await choose('{ broken');
    expect(await screen.findByText(/ファイルの形式に問題がある/)).toBeInTheDocument();
    expect(loadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '適用する' })).not.toBeInTheDocument();
  });

  it('参照のエラーが1件でもあれば適用を出さない', async () => {
    loadMock.mockResolvedValue(snapshot());
    await choose(importJson([{ id: 'q9', reason: null }]));
    expect(await screen.findByText(/適用できません/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '適用する' })).not.toBeInTheDocument();
  });

  it('変化が0件なら「適用する変更はありません」とし、適用を出さない', async () => {
    loadMock.mockResolvedValue(snapshot());
    await choose(importJson([]));
    expect(await screen.findByText('適用する変更はありません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '適用する' })).not.toBeInTheDocument();
  });

  it('警告は確認のチェックを付けるまで適用を無効にする', async () => {
    loadMock.mockResolvedValue(snapshot('2026-11-03T00:00:00.000Z'));
    const { user, onHoldingChange } = await choose(importJson([{ id: 'q1', reason: '古い' }], '2026-11-02T00:00:00.000Z'));
    const apply = await screen.findByRole('button', { name: '適用する' });
    expect(apply).toBeDisabled();
    expect(onHoldingChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('checkbox', { name: /警告を確認しました/ }));
    expect(apply).toBeEnabled();
  });

  it('適用中は適用を無効にし、成功で件数と解消したフラグの件数を出してファイルとプレビューを破棄する', async () => {
    loadMock.mockResolvedValue(snapshot());
    let resolve!: (r: ApplyResult) => void;
    applyMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user, onHoldingChange } = await choose(importJson([{ id: 'q1', reason: '古い' }]));
    const apply = await screen.findByRole('button', { name: '適用する' });
    await user.click(apply);
    expect(screen.getByRole('button', { name: '適用中…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '適用中…' }));
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]?.[0]).toMatchObject({ subjectId: 's1', questionDisables: [{ id: 'q1' }] });
    resolve(RESULT);
    expect(await screen.findByText(/解消したフラグ: 3件/)).toBeInTheDocument();
    expect(screen.getByText(/問題の修正: 2件/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '変更の件数' })).not.toBeInTheDocument();
    expect(onHoldingChange).toHaveBeenLastCalledWith(false);
  });

  it('stale_preview では再検証のボタンを出し、同じファイルを現在のデータで検証し直す', async () => {
    loadMock.mockResolvedValue(snapshot());
    applyMock.mockRejectedValue(new StalePreviewError());
    const { user } = await choose(importJson([{ id: 'q1', reason: '古い' }]));
    await user.click(await screen.findByRole('button', { name: '適用する' }));
    expect(await screen.findByText(/再検証してください/)).toBeInTheDocument();
    loadMock.mockResolvedValue(snapshot('2026-11-03T00:00:00.000Z'));
    await user.click(screen.getByRole('button', { name: '再検証' }));
    await waitFor(() => expect(loadMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: '適用する' })).toBeInTheDocument();
  });

  it('その他の失敗では日本語の理由を出し、プレビューを保持する', async () => {
    loadMock.mockResolvedValue(snapshot());
    applyMock.mockRejectedValue(new Error('取込の適用に失敗しました: boom'));
    const { user, onHoldingChange } = await choose(importJson([{ id: 'q1', reason: '古い' }]));
    await user.click(await screen.findByRole('button', { name: '適用する' }));
    expect(await screen.findByText('取込の適用に失敗しました: boom')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '変更の件数' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '適用する' })).toBeEnabled();
    expect(onHoldingChange).toHaveBeenLastCalledWith(true);
  });

  it('スナップショットの取得に失敗したら理由と再試行を出す', async () => {
    loadMock.mockRejectedValueOnce(new Error('取込データの取得に失敗しました: x'));
    const { user } = await choose(importJson([{ id: 'q1', reason: '古い' }]));
    expect(await screen.findByText('取込データの取得に失敗しました: x')).toBeInTheDocument();
    loadMock.mockResolvedValue(snapshot());
    await user.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('button', { name: '適用する' })).toBeInTheDocument();
  });
});

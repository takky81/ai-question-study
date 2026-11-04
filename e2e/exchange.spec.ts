import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD, loginAsOwner } from './helpers';

// question-exchange（入出力）の E2E。
// 出力の describe は seed（「E2E 交換テスト」「E2E 交換大量データ」）を読むだけで、書き換えない。
// 取込など seed を変える describe は、実行ごとに接頭辞付きの自前データを作ること。
// 画面は PC 優先のため、画面操作の describe は desktop プロジェクトだけで実行する。

// ============================================================
// 共通の補助
// ============================================================

function loadEnv(): { url: string; key: string } {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m?.[1] !== undefined) env[m[1]] = m[2] ?? '';
    }
  } catch {
    // .env.local がなければ環境変数だけを使う
  }
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が必要です');
  return { url, key };
}

async function ownerClient(): Promise<SupabaseClient> {
  const { url, key } = loadEnv();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (error) throw error;
  return client;
}

// PC 優先の画面操作の describe は desktop だけで実行する（beforeAll での skip はグループ全体に効く）
function desktopOnly(): void {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'PC 優先の画面操作のため desktop で実行する');
  });
}

// seed の ID
const EX_SUBJECT = 'c0000000-0000-4000-8000-000000000001';
const BULK_SUBJECT = 'c0000000-0000-4000-8000-000000000002';
const kwId = (n: number) => `c0000000-0000-4000-8000-00000000c${n}`;
const qId = (n: number) => `c0000000-0000-4000-8000-00000000d00${n}`;

type ExportFile = {
  format: string;
  version: number;
  subject: { id: string; name: string };
  conditions: Record<string, unknown>;
  keywords: { id: string; path: string[] }[];
  questions: {
    id: string;
    status: 'active' | 'disabled';
    disabledReason: string | null;
    keywordIds: string[];
    choices: { id: string }[];
    openFlags: { flag: string; note: string | null }[];
  }[];
};

async function openExport(page: Page): Promise<Locator> {
  await loginAsOwner(page);
  await page.goto('/exchange');
  await expect(page.getByRole('heading', { level: 1, name: '入出力' })).toBeVisible();
  await page.getByRole('tab', { name: '出力' }).click();
  return page.getByRole('tabpanel', { name: '出力' });
}

async function selectSubject(panel: Locator, name: string): Promise<void> {
  const select = panel.getByLabel('科目', { exact: true });
  await expect(select).toBeEnabled();
  await select.selectOption({ label: name });
  await expect(panel.getByRole('tree', { name: '範囲' })).toBeVisible();
}

async function downloadExport(page: Page, panel: Locator): Promise<{ fileName: string; file: ExportFile }> {
  const button = panel.getByRole('button', { name: '出力', exact: true });
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  const file = JSON.parse(readFileSync(path, 'utf8')) as ExportFile;
  return { fileName: download.suggestedFilename(), file };
}

const ids = (file: ExportFile) => file.questions.map((q) => q.id).sort();
const question = (file: ExportFile, id: string) => {
  const q = file.questions.find((x) => x.id === id);
  if (!q) throw new Error(`問題 ${id} が出力にありません`);
  return q;
};

// ============================================================
// 出力（1.3〜1.7、2.3〜2.9）
// ============================================================

test.describe('出力', () => {
  desktopOnly();

  test('途中のキーワードの範囲とフラグ条件で、配下の問題と未解消のフラグだけが出力される（1.3〜1.5、2.3〜2.8）', async ({
    page,
  }) => {
    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換テスト');
    await panel.getByRole('treeitem', { name: 'ソート', exact: true }).click();
    await panel.getByRole('radio', { name: '未解消のフラグがある' }).check();
    await panel.getByLabel('正答率の下限（%）').fill('20');
    await expect(panel.getByText('2 問が一致します')).toBeVisible();

    const { fileName, file } = await downloadExport(page, panel);
    expect(fileName).toContain('E2E');
    expect(fileName.endsWith('.json')).toBe(true);
    expect(file.format).toBe('ai-question-study/export');
    expect(file.version).toBe(1);
    expect(file.subject).toEqual({ id: EX_SUBJECT, name: 'E2E 交換テスト' });
    expect(file.conditions).toMatchObject({ keywordId: kwId(102), flag: 'any', correctRateMin: 0.2, includeDisabled: false });
    // キーワード階層は範囲によらず全体を持つ（2.3）
    expect(file.keywords.map((k) => k.id).sort()).toEqual([101, 102, 103, 104, 105].map(kwId).sort());
    expect(file.keywords.find((k) => k.id === kwId(103))?.path).toEqual(['アルゴリズム', 'ソート', 'クイックソート']);

    // ソート配下・未解消フラグあり・正答率 20% 以上: d001（100%）と d002（25%）。d005 は無効なので含まれない
    expect(ids(file)).toEqual([qId(1), qId(2)]);
    expect(question(file, qId(1)).openFlags.map((f) => f.flag)).toEqual(['defective']);
    expect(question(file, qId(2)).openFlags).toEqual([expect.objectContaining({ flag: 'comment', note: 'E2E 用のコメント' })]);
    for (const q of file.questions) {
      expect(q.status).toBe('active');
      expect(q.choices).toHaveLength(4);
    }
  });

  test('正答率の範囲で絞り込まれ、解消済みのフラグは出力されない（1.6、1.7、2.5）', async ({ page }) => {
    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換テスト');
    await panel.getByRole('treeitem', { name: 'ソート', exact: true }).click();
    await panel.getByLabel('正答率の下限（%）').fill('20');
    await panel.getByLabel('正答率の上限（%）').fill('60');
    await expect(panel.getByText('2 問が一致します')).toBeVisible();

    const { file } = await downloadExport(page, panel);
    // d002（25%）と d003（50%）。d001（100%）・d007（未解答）・d004（範囲外）・d006（削除）は含まれない
    expect(ids(file)).toEqual([qId(2), qId(3)]);
    // d003 のフラグは解消済みのため出力されない
    expect(question(file, qId(3)).openFlags).toEqual([]);
  });

  test('「無効化された問題を含める」で無効の問題が状態と理由付きで出力される（1.5、2.6）', async ({ page }) => {
    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換テスト');
    await panel.getByRole('treeitem', { name: 'ソート', exact: true }).click();
    await panel.getByRole('radio', { name: '未解消のフラグがある' }).check();
    await expect(panel.getByText('2 問が一致します')).toBeVisible();
    await panel.getByRole('checkbox', { name: '無効化された問題を含める' }).check();
    await expect(panel.getByText('3 問が一致します')).toBeVisible();

    const { file } = await downloadExport(page, panel);
    expect(file.conditions).toMatchObject({ includeDisabled: true });
    expect(ids(file)).toEqual([qId(1), qId(2), qId(5)]);
    const disabled = question(file, qId(5));
    expect(disabled.status).toBe('disabled');
    expect(disabled.disabledReason).toBe('E2E 用の無効化');
    expect(disabled.keywordIds).toEqual([kwId(103)]);
    expect(disabled.openFlags.map((f) => f.flag)).toEqual(['low_value']);
    expect(question(file, qId(1)).status).toBe('active');
    // 削除済みの問題は含めても出力されない
    expect(file.questions.some((q) => q.id === qId(6))).toBe(false);
  });

  test('1,200 問・選択肢 4,800 件が欠落・重複なく DB と一致する（2.9）', async ({ page }) => {
    test.setTimeout(120_000);
    const db = await ownerClient();
    const dbQuestions: string[] = [];
    const dbChoices: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('questions')
        .select('id')
        .eq('subject_id', BULK_SUBJECT)
        .is('deleted_at', null)
        .is('disabled_at', null)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      dbQuestions.push(...data.map((r) => r.id as string));
      if (data.length < 1000) break;
    }
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('choices')
        .select('id, questions!inner(subject_id)')
        .eq('questions.subject_id', BULK_SUBJECT)
        .is('removed_at', null)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      dbChoices.push(...data.map((r) => r.id as string));
      if (data.length < 1000) break;
    }
    expect(dbQuestions).toHaveLength(1200);
    expect(dbChoices).toHaveLength(4800);

    const panel = await openExport(page);
    await selectSubject(panel, 'E2E 交換大量データ');
    await expect(panel.getByText('1200 問が一致します')).toBeVisible();
    const { file } = await downloadExport(page, panel);

    const qIds = file.questions.map((q) => q.id);
    const cIds = file.questions.flatMap((q) => q.choices.map((c) => c.id));
    expect(qIds).toHaveLength(1200);
    expect(new Set(qIds).size).toBe(1200);
    expect(cIds).toHaveLength(4800);
    expect(new Set(cIds).size).toBe(4800);
    expect([...qIds].sort()).toEqual([...dbQuestions].sort());
    expect([...cIds].sort()).toEqual([...dbChoices].sort());
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD, loginAsOwner } from './helpers';

// subject-catalog の画面操作の E2E。
// テストデータは RUN 接頭辞付きの名前で作り、afterAll で所有者の supabase-js から物理削除する。
// カタログは PC 優先の画面のため desktop プロジェクトで実行する（モバイル幅のタブ切り替えは別の describe で扱う）。

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

const RUN = `e2e-${Date.now()}`;
let db: SupabaseClient;

async function seedSubject(name: string): Promise<string> {
  const { data, error } = await db.from('subjects').insert({ name: `${RUN}-${name}` }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

async function seedKeyword(subjectId: string, name: string, parentId: string | null = null): Promise<string> {
  const { data, error } = await db
    .from('keywords')
    .insert({ subject_id: subjectId, parent_id: parentId, name })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedQuestion(subjectId: string, keywordIds: string[], stem = '問題文'): Promise<string> {
  const { data, error } = await db.rpc('save_question', {
    p: {
      id: null,
      subjectId,
      kind: 'keyword',
      stem,
      explanation: '全体の解説',
      keywordIds,
      choices: [
        { body: '正解', explanation: '解説1', isCorrect: true },
        { body: '不正解', explanation: '解説2', isCorrect: false },
      ],
    },
  });
  if (error) throw error;
  return (typeof data === 'string' ? data : (data as { id: string }).id) as string;
}

async function keywordIdByName(subjectId: string, name: string): Promise<string> {
  const { data, error } = await db.from('keywords').select('id').eq('subject_id', subjectId).eq('name', name).single();
  if (error) throw error;
  return data.id as string;
}

const tree = (page: Page) => page.getByRole('tree', { name: 'キーワード' });
const treeItem = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });

// 子の行に当たらないよう、ノード自身の行をクリックして選択する
async function selectKeyword(page: Page, name: string): Promise<void> {
  await treeItem(page, name).locator(':scope > div').click();
  await expect(treeItem(page, name)).toHaveAttribute('aria-selected', 'true');
}

const panel = (page: Page, name: string): Locator => page.getByRole('group', { name: `「${name}」の操作` });

async function topLevelNames(page: Page): Promise<string[]> {
  return tree(page)
    .locator(':scope > [role="treeitem"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  const { url, key } = loadEnv();
  db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (error) throw error;
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop' || !db) return;
  // 画面で作った科目も含め、RUN 接頭辞の科目を物理削除する（配下は cascade で消える）
  const { error } = await db.from('subjects').delete().like('name', `${RUN}-%`);
  if (error) throw error;
  await db.auth.signOut();
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'カタログは PC 優先の画面のため desktop で実行する');
  await loginAsOwner(page);
});

// ============================================================
// 科目・キーワード操作（2.1〜2.5、3.1〜3.10）
// ============================================================

test.describe('科目・キーワード操作', () => {
  test('科目を作成・改名でき、空・重複名はエラーになる（2.1〜2.3）', async ({ page }) => {
    const name = `${RUN}-科目A`;
    const renamed = `${RUN}-科目B`;
    await page.goto('/catalog');
    await expect(page.getByRole('heading', { level: 1, name: 'カタログ' })).toBeVisible();

    await page.getByLabel('新しい科目名').fill(name);
    await page.getByRole('button', { name: '科目を作成' }).click();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(page.getByLabel('新しい科目名')).toHaveValue('');

    // 空
    await page.getByLabel('新しい科目名').fill('   ');
    await page.getByRole('button', { name: '科目を作成' }).click();
    await expect(page.getByRole('alert')).toHaveText('科目名を入力してください');

    // 重複（DB の一意制約）
    await page.getByLabel('新しい科目名').fill(name);
    await page.getByRole('button', { name: '科目を作成' }).click();
    await expect(page.getByRole('alert')).toContainText('同じ名前がすでにあります');
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1);

    // 改名
    await page.getByRole('button', { name: `${name} の名前を変更` }).click();
    await page.getByLabel(`${name} の新しい名前`).fill(renamed);
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible();
  });

  test('科目の削除は件数を確認表示し、確定でキーワードを削除して問題を削除状態にする（2.4、2.5）', async ({ page }) => {
    const subjectId = await seedSubject('削除科目');
    const name = `${RUN}-削除科目`;
    const k1 = await seedKeyword(subjectId, 'K1');
    await seedKeyword(subjectId, 'K2', k1);
    const q = await seedQuestion(subjectId, [k1]);

    await page.goto('/catalog');
    await page.getByRole('button', { name: `${name} を削除` }).click();
    const dialog = page.getByRole('dialog', { name: `科目「${name}」を削除` });
    await expect(dialog).toContainText('配下のキーワード 2 件を削除し、問題 1 件を削除状態にします。');

    // キャンセルでは削除しない
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `${name} を削除` }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);

    const kws = await db.from('keywords').select('id').eq('subject_id', subjectId);
    expect(kws.error).toBeNull();
    expect(kws.data).toHaveLength(0);
    const qs = await db.from('questions').select('deleted_at').eq('id', q).single();
    expect(qs.error).toBeNull();
    expect(qs.data?.deleted_at).not.toBeNull();
  });

  test.describe('キーワード木', () => {
    let subjectId: string;

    test.beforeAll(async ({}, testInfo) => {
      if (testInfo.project.name !== 'desktop') return;
      subjectId = await seedSubject('キーワード科目');
    });

    test('追加・兄弟重複・並べ替えの再読込後の維持・改名で紐づけ維持（3.1〜3.5）', async ({ page }) => {
      await page.goto(`/catalog/${subjectId}`);
      const rootInput = page.getByLabel('科目の直下に追加するキーワード名');
      for (const n of ['A', 'B', 'C']) {
        await rootInput.fill(n);
        await page.getByRole('button', { name: '直下に追加' }).click();
        await expect(treeItem(page, n)).toBeVisible();
      }
      expect(await topLevelNames(page)).toEqual(['A', 'B', 'C']);

      // 空・兄弟重複
      await rootInput.fill('');
      await page.getByRole('button', { name: '直下に追加' }).click();
      await expect(page.getByRole('alert')).toHaveText('キーワード名を入力してください');
      await rootInput.fill('A');
      await page.getByRole('button', { name: '直下に追加' }).click();
      await expect(page.getByRole('alert')).toHaveText('同じ親の下に同じ名前のキーワードがあります');
      expect(await topLevelNames(page)).toEqual(['A', 'B', 'C']);

      // 子の追加（末尾に置かれ、展開される）。別の親の下なら同名でもよい
      await selectKeyword(page, 'A');
      for (const n of ['A1', 'B']) {
        await panel(page, 'A').getByLabel('「A」の子として追加する名前').fill(n);
        await panel(page, 'A').getByRole('button', { name: '子を追加' }).click();
        await expect(panel(page, 'A').getByLabel('「A」の子として追加する名前')).toHaveValue('');
      }
      await expect(treeItem(page, 'A')).toHaveAttribute('aria-expanded', 'true');
      const children = treeItem(page, 'A').getByRole('group').getByRole('treeitem');
      await expect(children).toHaveCount(2);
      await expect(children.nth(0)).toHaveAttribute('aria-label', 'A1');
      await expect(children.nth(0)).toHaveAttribute('aria-level', '2');
      await expect(children.nth(1)).toHaveAttribute('aria-label', 'B');

      // 折りたたみ
      await treeItem(page, 'A').locator(':scope > div > span').first().click();
      await expect(treeItem(page, 'A')).toHaveAttribute('aria-expanded', 'false');
      await expect(treeItem(page, 'A1')).toHaveCount(0);
      await treeItem(page, 'A').locator(':scope > div > span').first().click();
      await expect(treeItem(page, 'A1')).toBeVisible();

      // 改名で問題の紐づけは維持される
      const a1 = await keywordIdByName(subjectId, 'A1');
      const q = await seedQuestion(subjectId, [a1], '改名の紐づけ確認');
      await selectKeyword(page, 'A1');
      await panel(page, 'A1').getByLabel('「A1」の新しい名前').fill('A1改');
      await panel(page, 'A1').getByRole('button', { name: '名前を変更' }).click();
      await expect(treeItem(page, 'A1改')).toBeVisible();
      const links = await db.from('question_keywords').select('keyword_id').eq('question_id', q);
      expect(links.error).toBeNull();
      expect(links.data?.map((r) => r.keyword_id)).toEqual([a1]);

      // 並べ替え（C を上へ）は再読込後も維持される
      await selectKeyword(page, 'C');
      await panel(page, 'C').getByRole('button', { name: '上へ' }).click();
      await expect.poll(() => topLevelNames(page)).toEqual(['A', 'C', 'B']);
      await page.reload();
      await expect(treeItem(page, 'A')).toBeVisible();
      expect(await topLevelNames(page)).toEqual(['A', 'C', 'B']);
    });

    test('部分木ごとの移動と、自分自身・配下への移動拒否（3.6、3.7）', async ({ page }) => {
      const p = await seedKeyword(subjectId, 'P');
      const p1 = await seedKeyword(subjectId, 'P1', p);
      const t = await seedKeyword(subjectId, 'T');

      await page.goto(`/catalog/${subjectId}`);
      await selectKeyword(page, 'P');
      const select = panel(page, 'P').getByLabel('「P」の移動先');
      // 移動先の候補に自分自身と配下は出さない
      const options = await select.locator('option').allTextContents();
      expect(options).toContain('（科目の直下）');
      expect(options).toContain('T');
      expect(options).not.toContain('P');
      expect(options.some((o) => o.startsWith('P / '))).toBe(false);

      // T の下へ移動すると P1 も一緒に移動し、T の子の末尾に置かれる
      const existing = await seedKeyword(subjectId, 'T0', t);
      await page.reload();
      await selectKeyword(page, 'P');
      await panel(page, 'P').getByLabel('「P」の移動先').selectOption({ label: 'T' });
      await panel(page, 'P').getByRole('button', { name: '移動' }).click();
      await expect(treeItem(page, 'T')).toHaveAttribute('aria-expanded', 'true');
      const tChildren = treeItem(page, 'T').locator(':scope > [role="group"] > [role="treeitem"]');
      await expect(tChildren).toHaveCount(2);
      await expect(tChildren.nth(0)).toHaveAttribute('aria-label', 'T0');
      await expect(tChildren.nth(1)).toHaveAttribute('aria-label', 'P');
      const rows = await db.from('keywords').select('id, parent_id').in('id', [p, p1, existing]);
      expect(rows.error).toBeNull();
      const parent = new Map(rows.data?.map((r) => [r.id as string, r.parent_id as string | null]));
      expect(parent.get(p)).toBe(t);
      expect(parent.get(p1)).toBe(p);

      // 画面の候補が古いうちに T が P の配下へ移されていた場合、DB が拒否してエラーを表示する
      await page.reload();
      await treeItem(page, 'T').locator(':scope > div > span').first().click();
      await selectKeyword(page, 'T0');
      // T0 の配下に行を作り、画面に出ている候補 P1 をその下へ移しておく（画面は古い候補のまま）
      const under = await seedKeyword(subjectId, 'T0子', existing);
      await panel(page, 'T0').getByLabel('「T0」の移動先').selectOption({ label: 'T / P / P1' });
      const moved = await db.from('keywords').update({ parent_id: under }).eq('id', p1);
      expect(moved.error).toBeNull();
      await panel(page, 'T0').getByRole('button', { name: '移動' }).click();
      await expect(page.getByRole('alert')).toHaveText(/キーワードを自分自身または配下へは移動できません/);
      const t0 = await db.from('keywords').select('parent_id').eq('id', existing).single();
      expect(t0.data?.parent_id).toBe(t);
    });

    test('削除は件数を確認表示し、唯一の紐づけを失った問題を無効化する（3.8〜3.10）', async ({ page }) => {
      const d = await seedKeyword(subjectId, 'D');
      const d1 = await seedKeyword(subjectId, 'D1', d);
      const keep = await seedKeyword(subjectId, 'E');
      const onlyD1 = await seedQuestion(subjectId, [d1], 'D1 だけに紐づく');
      const alsoE = await seedQuestion(subjectId, [d, keep], 'D と E に紐づく');

      await page.goto(`/catalog/${subjectId}`);
      await selectKeyword(page, 'D');
      await panel(page, 'D').getByRole('button', { name: '削除' }).click();
      const dialog = page.getByRole('dialog', { name: 'キーワード「D」を削除' });
      await expect(dialog).toContainText('配下を含むキーワード 2 件を削除します。');
      await expect(dialog).toContainText(
        '紐づけが外れる問題 2 件のうち、紐づくキーワードがなくなり無効化される問題 1 件があります。',
      );
      await dialog.getByRole('button', { name: '削除する' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(treeItem(page, 'D')).toHaveCount(0);
      await expect(treeItem(page, 'E')).toBeVisible();

      const kws = await db.from('keywords').select('id').in('id', [d, d1]);
      expect(kws.data).toHaveLength(0);
      const qs = await db
        .from('questions')
        .select('id, disabled_at, disabled_reason, deleted_at')
        .in('id', [onlyD1, alsoE]);
      expect(qs.error).toBeNull();
      const byId = new Map(qs.data?.map((r) => [r.id as string, r]));
      expect(byId.get(onlyD1)?.disabled_at).not.toBeNull();
      expect(byId.get(onlyD1)?.disabled_reason).toBe('no_keyword');
      expect(byId.get(onlyD1)?.deleted_at).toBeNull();
      expect(byId.get(alsoE)?.disabled_at).toBeNull();
      const links = await db.from('question_keywords').select('keyword_id').eq('question_id', alsoE);
      expect(links.data?.map((r) => r.keyword_id)).toEqual([keep]);
    });
  });
});

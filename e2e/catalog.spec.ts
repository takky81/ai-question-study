import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD, loginAsOwner } from './helpers';

// subject-catalog の画面操作の E2E。
// テストデータは RUN とプロジェクト名の接頭辞付きの名前で作り、afterAll で所有者の supabase-js から物理削除する。
// 科目・キーワード操作と問題編集・状態操作は PC 優先の画面のため desktop プロジェクトだけで実行し、
// 一覧・ページング・レイアウト・アクセシビリティは desktop と mobile の両方で実行する。
// データの接頭辞はプロジェクトごとに分け、削除も自プロジェクトの接頭辞に限る。

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

const RUN = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let db: SupabaseClient;
// RUN とプロジェクト名から作る接頭辞（beforeAll で設定する）
let PREFIX = RUN;

async function seedSubject(name: string): Promise<string> {
  const { data, error } = await db.from('subjects').insert({ name: `${PREFIX}-${name}` }).select('id').single();
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
  PREFIX = `${RUN}-${testInfo.project.name}`;
  const { url, key } = loadEnv();
  db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.auth.signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (error) throw error;
});

test.afterAll(async () => {
  if (!db) return;
  // 画面で作った科目も含め、このプロジェクトの接頭辞の科目を物理削除する（配下は cascade で消える）
  const { error } = await db.from('subjects').delete().like('name', `${PREFIX}-%`);
  if (error) throw error;
  await db.auth.signOut();
});

test.beforeEach(async ({ page }) => {
  await loginAsOwner(page);
});

// PC 優先の画面操作の describe は desktop だけで実行する（beforeAll での skip はグループ全体に効く）
function desktopOnly(): void {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'PC 優先の画面操作のため desktop で実行する');
  });
}

// ============================================================
// 科目・キーワード操作（2.1〜2.5、3.1〜3.10）
// ============================================================

test.describe('科目・キーワード操作', () => {
  desktopOnly();

  test('科目を作成・改名でき、空・重複名はエラーになる（2.1〜2.3）', async ({ page }) => {
    const name = `${PREFIX}-科目A`;
    const renamed = `${PREFIX}-科目B`;
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
    const name = `${PREFIX}-削除科目`;
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

// ============================================================
// 問題編集・状態操作（1.4、4.4〜4.8、5.8、5.9、6.1〜6.3、6.6、9.5、9.6）
// ============================================================

test.describe('問題編集・状態操作', () => {
  desktopOnly();
  let subjectId: string;
  let kw: string;

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;
    subjectId = await seedSubject('問題科目');
    kw = await seedKeyword(subjectId, '親語');
    await seedKeyword(subjectId, '子語', kw);
  });

  const SAVE_RPC = '**/rest/v1/rpc/save_question';
  const bodies = (page: Page) => page.getByRole('textbox', { name: /^選択肢 \d+ の本文$/ });
  const saveButton = (page: Page) => page.getByRole('button', { name: /^(保存|警告を確認して保存|保存中…)$/ });
  const stemBox = (page: Page) => page.getByRole('textbox', { name: '問題文', exact: true });
  const choiceBox = (page: Page, n: number, part: '本文' | '解説') =>
    page.getByRole('textbox', { name: `選択肢 ${n} の${part}`, exact: true });

  async function questionCount(): Promise<number> {
    const { count, error } = await db
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('subject_id', subjectId);
    if (error) throw error;
    return count ?? 0;
  }

  test('新規作成: 種別ごとの空欄数、エラー時は保存しない、警告は確認後に保存、正解の色と印（4.4、4.6、5.8、5.9、9.5）', async ({
    page,
  }) => {
    const before = await questionCount();
    let requests = 0;
    page.on('request', (r) => {
      if (r.url().includes('/rest/v1/rpc/save_question')) requests++;
    });
    await page.goto(`/catalog/${subjectId}/questions/new`);
    await expect(page.getByRole('heading', { level: 1, name: '新しい問題' })).toBeVisible();
    // キーワード問題は6個、特徴問題は4個の空欄。「わからない」はない（4.4、4.9）
    await expect(bodies(page)).toHaveCount(6);
    await page.getByRole('radio', { name: '特徴などを答える問題' }).check();
    await expect(bodies(page)).toHaveCount(4);
    await page.getByRole('radio', { name: 'キーワードを答える問題' }).check();
    await expect(bodies(page)).toHaveCount(6);
    await expect(page.getByText('わからない')).toHaveCount(0);

    // エラーがあれば保存せず、欄の近くに説明を出す（5.8）
    await saveButton(page).click();
    await expect(page.getByText('問題文を入力してください。')).toBeVisible();
    await expect(page.getByText('キーワードを1つ以上紐づけてください。')).toBeVisible();
    await expect(page.getByText(/エラーが \d+ 件あります/)).toBeVisible();
    await expect(stemBox(page)).toHaveAttribute('aria-invalid', 'true');
    const stemDesc = await stemBox(page).getAttribute('aria-describedby');
    expect(stemDesc).toBeTruthy();
    await expect(page.locator(`[id="${stemDesc}"]`)).toContainText('問題文を入力してください。');
    expect(requests).toBe(0);
    expect(await questionCount()).toBe(before);

    // 選択肢を4個に減らして埋める（原則6個より少ないので警告だけになる）
    await page.getByRole('button', { name: '選択肢 6 を削除' }).click();
    await page.getByRole('button', { name: '選択肢 5 を削除' }).click();
    await expect(bodies(page)).toHaveCount(4);
    await stemBox(page).fill('新規の問題文');
    await page.getByRole('textbox', { name: '問題の解説', exact: true }).fill('新規の解説');
    await page.getByRole('checkbox', { name: '子語' }).check();
    await expect(page.getByRole('list', { name: '選択済みのキーワード' })).toHaveText('親語 / 子語');
    for (let i = 1; i <= 4; i++) {
      await choiceBox(page, i, '本文').fill(`新規${i}`);
      await choiceBox(page, i, '解説').fill(`新規${i} の解説`);
    }
    await page.getByRole('radio', { name: '選択肢 2 を正解にする' }).check();

    // 正解の色と印（9.5）: 正解の選択肢だけ mark-correct と ○、警告色は使わない
    const items = page.getByRole('group', { name: '選択肢' }).locator('ol > li');
    await expect(items.nth(1)).toHaveClass(/mark-correct/);
    await expect(items.nth(1)).toContainText('○');
    await expect(items.nth(0)).not.toHaveClass(/mark-correct/);
    await expect(items.nth(0)).not.toContainText('○');
    const colors = await items.nth(1).evaluate((el) => {
      const probe = (cls: string) => {
        const s = document.createElement('span');
        s.className = cls;
        document.body.append(s);
        const c = getComputedStyle(s).color;
        s.remove();
        return c;
      };
      const all = [el, ...Array.from(el.querySelectorAll('*'))];
      return {
        color: getComputedStyle(el).color,
        correct: probe('mark-correct'),
        warn: probe('text-warn'),
        warnClasses: all.filter((e) => /\bwarn\b|-warn\b/.test(e.getAttribute('class') ?? '')).length,
      };
    });
    expect(colors.color).toBe(colors.correct);
    expect(colors.color).not.toBe(colors.warn);
    expect(colors.warnClasses).toBe(0);

    // 警告だけなら一覧を出し、確認後に保存する（5.9）
    await saveButton(page).click();
    await expect(page.getByText('警告があります。内容を確認してください。')).toBeVisible();
    await expect(page.getByText(/選択肢は原則 6 個です（現在 4 個）/).first()).toBeVisible();
    await expect(saveButton(page)).toHaveText('警告を確認して保存');
    expect(requests).toBe(0);
    expect(await questionCount()).toBe(before);
    await saveButton(page).click();

    await expect(page).toHaveURL(new RegExp(`/catalog/${subjectId}/questions/[0-9a-f-]{36}$`));
    await expect(page.getByRole('heading', { level: 1, name: '問題の編集' })).toBeVisible();
    await expect(page.getByText('保存済み')).toBeVisible();
    expect(requests).toBe(1);

    // 問題・選択肢・紐づけが一括で保存されている（4.6）
    const id = page.url().split('/').pop()!;
    const q = await db.from('questions').select('stem, kind').eq('id', id).single();
    expect(q.data).toEqual({ stem: '新規の問題文', kind: 'keyword' });
    const cs = await db.from('choices').select('body, is_correct').eq('question_id', id).is('removed_at', null).order('position');
    expect(cs.data?.map((c) => [c.body, c.is_correct])).toEqual([
      ['新規1', false],
      ['新規2', true],
      ['新規3', false],
      ['新規4', false],
    ]);
    const links = await db.from('question_keywords').select('keyword_id').eq('question_id', id);
    expect(links.data?.map((r) => r.keyword_id)).toEqual([await keywordIdByName(subjectId, '子語')]);
  });

  test('再編集で問題と選択肢の ID が変わらず、並べ替えが保存される（1.4、4.5、4.6）', async ({ page }) => {
    const id = await seedQuestion(subjectId, [kw], '再編集の問題');
    const before = await db.from('choices').select('id, body').eq('question_id', id).is('removed_at', null).order('position');
    const ids = new Map(before.data?.map((c) => [c.body as string, c.id as string]));

    await page.goto(`/catalog/${subjectId}/questions/${id}`);
    await expect(stemBox(page)).toHaveValue('再編集の問題');
    await expect(bodies(page)).toHaveCount(2);
    await stemBox(page).fill('再編集後の問題');
    await page.getByRole('button', { name: '選択肢 2 を上へ' }).click();
    await expect(choiceBox(page, 1, '本文')).toHaveValue('不正解');
    await saveButton(page).click();
    // 2個（原則6個）なので警告を確認して保存する
    await expect(saveButton(page)).toHaveText('警告を確認して保存');
    await saveButton(page).click();
    await expect(page.getByText('保存済み')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/questions/${id}$`));

    const q = await db.from('questions').select('id, stem').eq('id', id).single();
    expect(q.data).toEqual({ id, stem: '再編集後の問題' });
    const after = await db.from('choices').select('id, body').eq('question_id', id).is('removed_at', null).order('position');
    expect(after.data).toEqual([
      { id: ids.get('不正解'), body: '不正解' },
      { id: ids.get('正解'), body: '正解' },
    ]);
  });

  test('保存失敗時は入力を保持して再試行でき、保存中は二重保存しない（4.7、4.8）', async ({ page }) => {
    const id = await seedQuestion(subjectId, [kw], '失敗確認の問題');
    await page.goto(`/catalog/${subjectId}/questions/${id}`);
    await expect(stemBox(page)).toHaveValue('失敗確認の問題');
    await stemBox(page).fill('失敗後も残る問題文');
    await choiceBox(page, 1, '解説').fill('残る解説');

    // 保存の RPC を失敗させる
    let failed = 0;
    await page.route(SAVE_RPC, async (route) => {
      failed++;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'XX000', message: 'e2e failure', details: null, hint: null }),
      });
    });
    await saveButton(page).click();
    await saveButton(page).click(); // 警告の確認
    await expect(page.getByRole('alert')).toHaveText('問題の保存に失敗しました: e2e failure');
    expect(failed).toBe(1);
    await expect(stemBox(page)).toHaveValue('失敗後も残る問題文');
    await expect(choiceBox(page, 1, '解説')).toHaveValue('残る解説');
    await expect(saveButton(page)).toBeEnabled();
    const unchanged = await db.from('questions').select('stem').eq('id', id).single();
    expect(unchanged.data?.stem).toBe('失敗確認の問題');
    await page.unroute(SAVE_RPC);

    // 応答を遅らせ、保存中の連打でも要求が1回だけになることを確かめる
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let delayed = 0;
    await page.route(SAVE_RPC, async (route) => {
      delayed++;
      await gate;
      await route.continue();
    });
    await saveButton(page).click(); // 再試行（警告は確認済みのまま）
    await expect(saveButton(page)).toHaveText('保存中…');
    await expect(saveButton(page)).toBeDisabled();
    await saveButton(page).click({ force: true });
    await saveButton(page).dispatchEvent('click');
    expect(delayed).toBe(1);
    release();
    await expect(page.getByText('保存済み')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(delayed).toBe(1);
    await page.unroute(SAVE_RPC);
    const saved = await db.from('questions').select('stem').eq('id', id).single();
    expect(saved.data?.stem).toBe('失敗後も残る問題文');
    const cs = await db.from('choices').select('explanation').eq('question_id', id).is('removed_at', null).order('position');
    expect(cs.data?.[0]?.explanation).toBe('残る解説');
  });

  test('未保存の変更があると画面内の遷移とブラウザの離脱で破棄を確認する（9.6）', async ({ page }) => {
    const id = await seedQuestion(subjectId, [kw], '離脱確認の問題');
    await page.goto(`/catalog/${subjectId}/questions/${id}`);
    await expect(stemBox(page)).toHaveValue('離脱確認の問題');

    // 変更がなければ確認なしで移動できる
    await page.getByRole('link', { name: '問題一覧へ戻る' }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${subjectId}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`/catalog/${subjectId}/questions/${id}`);
    await stemBox(page).fill('未保存の変更');

    // 画面内の遷移: キャンセルで留まる
    await page.getByRole('link', { name: '問題一覧へ戻る' }).click();
    const dialog = page.getByRole('dialog', { name: '変更を破棄しますか' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/questions/${id}$`));
    await expect(stemBox(page)).toHaveValue('未保存の変更');

    // ブラウザの離脱: beforeunload の確認が出て、取り消せば留まる
    const dialogEvent = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const unload = await dialogEvent;
    expect(unload.type()).toBe('beforeunload');
    await unload.dismiss();
    expect(page.isClosed()).toBe(false);
    await expect(stemBox(page)).toHaveValue('未保存の変更');

    // 画面内の遷移: 破棄すると保存せずに移動する
    await page.getByRole('link', { name: '問題一覧へ戻る' }).click();
    await dialog.getByRole('button', { name: '破棄して移動' }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${subjectId}$`));
    const q = await db.from('questions').select('stem').eq('id', id).single();
    expect(q.data?.stem).toBe('離脱確認の問題');
  });

  test('一覧から無効化（理由）・有効化・削除（確認と消失）ができる（6.1〜6.3、6.6）', async ({ page }) => {
    const stem = '状態操作の問題';
    const id = await seedQuestion(subjectId, [kw], stem);
    await page.goto(`/catalog/${subjectId}`);
    const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: `「${stem}」を編集` }) });
    await expect(row).toContainText('有効');

    // 無効化（理由つき）（6.1）
    await page.getByRole('button', { name: `「${stem}」を無効化` }).click();
    const disable = page.getByRole('dialog', { name: '問題を無効化' });
    await disable.getByLabel('無効化の理由（任意）').fill('E2E の理由');
    await disable.getByRole('button', { name: '無効にする' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `「${stem}」を有効に戻す` })).toBeVisible();
    await expect(row).toContainText('無効');
    let r = await db.from('questions').select('disabled_at, disabled_reason').eq('id', id).single();
    expect(r.data?.disabled_at).not.toBeNull();
    expect(r.data?.disabled_reason).toBe('E2E の理由');

    // 有効化で無効化の記録が消える（6.2）
    await page.getByRole('button', { name: `「${stem}」を有効に戻す` }).click();
    await expect(page.getByRole('button', { name: `「${stem}」を無効化` })).toBeVisible();
    r = await db.from('questions').select('disabled_at, disabled_reason').eq('id', id).single();
    expect(r.data).toEqual({ disabled_at: null, disabled_reason: null });

    // 削除: 元に戻せない旨の確認（6.6）。キャンセルでは消えない
    await page.getByRole('button', { name: `「${stem}」を削除` }).click();
    const del = page.getByRole('dialog', { name: '問題を削除' });
    await expect(del).toContainText('削除すると一覧から消え、元に戻せません。');
    await del.getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByRole('link', { name: `「${stem}」を編集` })).toBeVisible();
    await page.getByRole('button', { name: `「${stem}」を削除` }).click();
    await del.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: `「${stem}」を編集` })).toHaveCount(0);
    const d = await db.from('questions').select('deleted_at').eq('id', id).single();
    expect(d.data?.deleted_at).not.toBeNull();
    await page.reload();
    await expect(page.getByRole('link', { name: '問題を作成' })).toBeVisible();
    await expect(page.getByText(/^\d+ 件$/)).toBeVisible();
    await expect(page.getByRole('link', { name: `「${stem}」を編集` })).toHaveCount(0);

    // 削除した問題は編集の対象からも外れる（6.3）
    await page.goto(`/catalog/${subjectId}/questions/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: '問題が見つかりません' })).toBeVisible();
    await expect(page.getByRole('link', { name: '問題一覧へ戻る' })).toBeVisible();
  });

  test('紐づくキーワードがない問題は有効に戻せずエラーを表示する（6.2）', async ({ page }) => {
    const lone = await seedKeyword(subjectId, '消える語');
    const stem = '紐づけを失う問題';
    const id = await seedQuestion(subjectId, [lone], stem);
    // 唯一の紐づけ先を削除すると no_keyword で無効化される
    const removed = await db.rpc('delete_keyword', { p_keyword_id: lone });
    expect(removed.error).toBeNull();
    const q = await db.from('questions').select('disabled_reason').eq('id', id).single();
    expect(q.data?.disabled_reason).toBe('no_keyword');

    await page.goto(`/catalog/${subjectId}`);
    await page.getByRole('button', { name: `「${stem}」を有効に戻す` }).click();
    await expect(page.getByRole('alert')).toHaveText('紐づくキーワードがないため有効にできません');
    const after = await db.from('questions').select('disabled_at').eq('id', id).single();
    expect(after.data?.disabled_at).not.toBeNull();
  });
});

// ============================================================
// 一覧・ページング・レイアウト・アクセシビリティ（7.2〜7.5、9.1〜9.4）
// desktop（1280px）と mobile（390px）の両方で実行する
// ============================================================

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 1024;

// モバイル幅ではタブを切り替えて表示する。PC 幅はタブがないので何もしない
async function showTab(page: Page, name: 'キーワード' | '問題'): Promise<void> {
  if (!isMobile(page)) return;
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

const totalText = (page: Page) => page.getByText(/^\d+ 件$/);
const editLinks = (page: Page) => page.getByRole('link', { name: /^「.*」を編集$/ });

async function listedIds(page: Page): Promise<string[]> {
  return editLinks(page).evaluateAll((els) =>
    els.map((el) => (el.getAttribute('href') ?? '').split('/').pop() ?? ''),
  );
}

// 横スクロールが発生していない
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return el.scrollWidth - el.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(0);
}

// Tab（または Shift+Tab）だけで対象へフォーカスを移す
async function tabTo(page: Page, target: Locator, backward = false, max = 200): Promise<void> {
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(backward ? 'Shift+Tab' : 'Tab');
  }
  throw new Error('キーボードで対象へフォーカスを移せませんでした');
}

// フォーカス中の要素にアウトラインが表示されている（.focus-ring の 2px 実線）
async function expectFocusOutline(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  const style = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(style.style).not.toBe('none');
  expect(style.width).toBeGreaterThanOrEqual(2);
}

// 表示中の操作要素（ラジオ・チェックボックスはラベル、木の項目は行）の操作領域が 44px 以上
async function expectTapTargets(scope: Locator): Promise<number> {
  const found = await scope
    .locator('button, a[href], input[type="radio"], input[type="checkbox"], [role="treeitem"], [role="tab"]')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const area = el.matches('input')
            ? (el.closest('label') ?? el)
            : el.matches('[role="treeitem"]')
              ? (el.firstElementChild ?? el)
              : el;
          const r = area.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName, w: r.width, h: r.height };
        }),
    );
  const bad = found.filter((s) => s.w < 44 || s.h < 44);
  expect(bad, '44px 未満の操作要素').toEqual([]);
  return found.length;
}

test.describe('一覧・ページング・レイアウト・アクセシビリティ', () => {
  const TOTAL = 1050;
  const PAGE_SIZE = 50;
  const MARK = '目印語';
  let subjectId: string;
  let subjectName: string;
  let kw: { parent: string; mid: string; leaf: string; other: string };
  // 期待する表示順（created_at desc, id desc）と、投入時の番号
  let expectedOrder: string[];
  const indexOf = new Map<string, number>();

  // i 番目の問題の属性（絞り込みの期待値の計算にも使う）
  const attrs = (i: number) => ({
    kind: i % 2 === 1 ? 'feature' : 'keyword',
    disabled: i % 5 === 0,
    keyword: (['parent', 'mid', 'leaf', 'other'] as const)[i % 4]!,
    marked: i % 100 === 7,
  });
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const countWhere = (pred: (i: number) => boolean) => range(TOTAL).filter(pred).length;

  async function insertChunks<T extends object>(table: string, rows: T[], size: number): Promise<void> {
    for (let i = 0; i < rows.length; i += size) {
      const { error } = await db.from(table).insert(rows.slice(i, i + size));
      if (error) throw error;
    }
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    subjectId = await seedSubject('一覧科目');
    subjectName = `${PREFIX}-一覧科目`;
    const parent = await seedKeyword(subjectId, '親');
    const mid = await seedKeyword(subjectId, '中', parent);
    const leaf = await seedKeyword(subjectId, '葉', mid);
    const other = await seedKeyword(subjectId, '別');
    kw = { parent, mid, leaf, other };

    // 3件ずつ同時刻にして、同時刻の並び（id desc）も確かめる
    const base = Date.parse('2020-01-01T00:00:00Z');
    const questions = range(TOTAL).map((i) => {
      const a = attrs(i);
      return {
        subject_id: subjectId,
        kind: a.kind,
        stem: `一覧の問題${String(i).padStart(4, '0')}`,
        explanation: '一覧の解説',
        disabled_at: a.disabled ? new Date(base).toISOString() : null,
        created_at: new Date(base + Math.floor(i / 3) * 1000).toISOString(),
      };
    });
    const rows: { id: string; created_at: string; stem: string }[] = [];
    for (let i = 0; i < questions.length; i += 350) {
      const { data, error } = await db
        .from('questions')
        .insert(questions.slice(i, i + 350))
        .select('id, created_at, stem');
      if (error) throw error;
      rows.push(...(data as typeof rows));
    }
    expect(rows).toHaveLength(TOTAL);
    for (const r of rows) indexOf.set(r.id, Number(r.stem.slice(-4)));

    // 選択肢は問題ごとに正解1つ（遅延制約はリクエスト単位のトランザクション末尾で検査される）
    const choices = rows.flatMap((r) => {
      const marked = attrs(indexOf.get(r.id)!).marked;
      return [
        { question_id: r.id, position: 0, body: marked ? `正解の${MARK}` : '正解', explanation: '解説', is_correct: true },
        { question_id: r.id, position: 1, body: '不正解', explanation: '解説', is_correct: false },
      ];
    });
    await insertChunks('choices', choices, 700);
    const links = rows.map((r) => ({ question_id: r.id, keyword_id: kw[attrs(indexOf.get(r.id)!).keyword] }));
    await insertChunks('question_keywords', links, 525);

    // 期待順は投入側で独立に計算する（uuid の比較は小文字16進の文字列比較と同じ順）
    expectedOrder = [...rows]
      .sort((a, b) => {
        const t = Date.parse(b.created_at) - Date.parse(a.created_at);
        return t !== 0 ? t : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      })
      .map((r) => r.id);
  });

  test('1,050 件の全ページを辿り、欠落・重複なく新しい順で安定している（7.4、7.5）', async ({ page }) => {
    test.setTimeout(180_000);
    const pageCount = Math.ceil(TOTAL / PAGE_SIZE);
    const slice = (p: number) => expectedOrder.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    await page.goto(`/catalog/${subjectId}`);
    await showTab(page, '問題');
    await expect(totalText(page)).toHaveText(`${TOTAL} 件`);

    const seen: string[] = [];
    for (let p = 1; p <= pageCount; p++) {
      await expect(page.getByText(`${p} / ${pageCount} ページ`)).toBeVisible();
      await expect.poll(() => listedIds(page)).toEqual(slice(p));
      seen.push(...(await listedIds(page)));
      const next = page.getByRole('button', { name: '次へ' });
      if (p < pageCount) await next.click();
      else await expect(next).toBeDisabled();
    }
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    expect(new Set(seen)).toEqual(new Set(indexOf.keys()));
    // 作成時刻の新しい（投入番号の大きい組の）ものから並ぶ。同時刻の3件は id の降順
    const nums = seen.map((id) => Math.floor(indexOf.get(id)! / 3));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));

    // 再読込・前へ・URL 指定で同じページが同じ内容になる（安定）
    await page.reload();
    await showTab(page, '問題');
    await expect.poll(() => listedIds(page)).toEqual(slice(pageCount));
    await page.getByRole('button', { name: '前へ' }).click();
    await expect.poll(() => listedIds(page)).toEqual(slice(pageCount - 1));
    await page.goto(`/catalog/${subjectId}?page=11`);
    await showTab(page, '問題');
    await expect(page.getByText(`11 / ${pageCount} ページ`)).toBeVisible();
    await expect.poll(() => listedIds(page)).toEqual(slice(11));
  });

  test('途中ノードの選択で配下に紐づく問題に絞り込み、種別・状態・語でも絞り込める（7.2、7.3）', async ({ page }) => {
    await page.goto(`/catalog/${subjectId}`);
    await showTab(page, '問題');
    await expect(totalText(page)).toHaveText(`${TOTAL} 件`);

    // 木で途中ノード「中」を選ぶ（親を展開してから選ぶ）
    await showTab(page, 'キーワード');
    await treeItem(page, '親').locator(':scope > div > span').first().click();
    await selectKeyword(page, '中');
    await expect(page).toHaveURL(new RegExp(`keyword=${kw.mid}`));
    await showTab(page, '問題');
    const inMid = (i: number) => attrs(i).keyword === 'mid' || attrs(i).keyword === 'leaf';
    await expect(totalText(page)).toHaveText(`${countWhere(inMid)} 件`);
    await expect(page.getByRole('search', { name: '問題の絞り込み' })).toContainText('親 / 中');
    await expect.poll(async () => (await listedIds(page)).length).toBe(PAGE_SIZE);
    for (const id of await listedIds(page)) expect(inMid(indexOf.get(id)!)).toBe(true);

    // 種別・状態（7.3）
    await page.getByLabel('種別').selectOption('feature');
    await expect(page).toHaveURL(/kind=feature/);
    const midFeature = (i: number) => inMid(i) && attrs(i).kind === 'feature';
    await expect(totalText(page)).toHaveText(`${countWhere(midFeature)} 件`);
    await page.getByLabel('状態').selectOption('disabled');
    const midFeatureDisabled = (i: number) => midFeature(i) && attrs(i).disabled;
    await expect(totalText(page)).toHaveText(`${countWhere(midFeatureDisabled)} 件`);
    await expect.poll(async () => (await listedIds(page)).length).toBe(Math.min(PAGE_SIZE, countWhere(midFeatureDisabled)));
    for (const id of await listedIds(page)) expect(midFeatureDisabled(indexOf.get(id)!)).toBe(true);

    // キーワードの解除と条件の戻し
    // 条件の変更は1つずつ反映を待ってから次を行う
    await page.getByRole('button', { name: 'キーワードの指定を解除' }).click();
    await expect(page).not.toHaveURL(/keyword=/);
    await expect(totalText(page)).toHaveText(`${countWhere((i) => attrs(i).kind === 'feature' && attrs(i).disabled)} 件`);
    await page.getByLabel('種別').selectOption('');
    await expect(page).not.toHaveURL(/kind=/);
    await expect(totalText(page)).toHaveText(`${countWhere((i) => attrs(i).disabled)} 件`);
    await page.getByLabel('状態').selectOption('active');
    await expect(totalText(page)).toHaveText(`${countWhere((i) => !attrs(i).disabled)} 件`);
    await page.getByLabel('状態').selectOption('');
    await expect(totalText(page)).toHaveText(`${TOTAL} 件`);

    // 語（選択肢の本文も対象）
    const word = page.getByRole('searchbox', { name: '語' });
    await word.fill(MARK);
    await page.getByRole('button', { name: '検索' }).click();
    await expect(totalText(page)).toHaveText(`${countWhere((i) => attrs(i).marked)} 件`);
    await word.fill('一覧の問題0123');
    await page.getByRole('button', { name: '検索' }).click();
    await expect(totalText(page)).toHaveText('1 件');
    await expect(editLinks(page)).toHaveAccessibleName('「一覧の問題0123」を編集');

    // 条件は URL に保持され、編集画面から戻っても同じ一覧になる（7.3）
    await page.goto(`/catalog/${subjectId}?keyword=${kw.leaf}&kind=keyword&status=active`);
    await showTab(page, '問題');
    const leafKeywordActive = (i: number) =>
      attrs(i).keyword === 'leaf' && attrs(i).kind === 'keyword' && !attrs(i).disabled;
    await expect(totalText(page)).toHaveText(`${countWhere(leafKeywordActive)} 件`);
    await editLinks(page).first().click();
    await expect(page.getByRole('heading', { level: 1, name: '問題の編集' })).toBeVisible();
    // 「問題一覧へ戻る」で同じ条件の一覧に戻る（条件は URL に残る）
    await page.getByRole('link', { name: '問題一覧へ戻る' }).click();
    await expect.poll(() => new URL(page.url()).search).toBe(`?keyword=${kw.leaf}&kind=keyword&status=active`);
    await showTab(page, '問題');
    await expect(totalText(page)).toHaveText(`${countWhere(leafKeywordActive)} 件`);
    await expect(page.getByLabel('種別')).toHaveValue('keyword');
    await expect(page.getByLabel('状態')).toHaveValue('active');
  });

  test('管理区分の導線「カタログ」と、PC 幅の2列・モバイル幅のタブ切替と横スクロールなし（9.1〜9.3）', async ({
    page,
  }) => {
    await page.goto('/');
    if (isMobile(page)) {
      await page.getByRole('button', { name: 'メニュー' }).click();
      const manage = page.getByRole('navigation', { name: '管理メニュー' }).getByRole('region', { name: '管理' });
      await manage.getByRole('link', { name: 'カタログ' }).click();
    } else {
      const manage = page.getByRole('navigation', { name: 'サイドナビゲーション' }).getByRole('region', { name: '管理' });
      await manage.getByRole('link', { name: 'カタログ' }).click();
    }
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole('heading', { level: 1, name: 'カタログ' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('link', { name: subjectName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${subjectId}$`));
    const listHeading = page.getByRole('heading', { level: 2, name: '問題', exact: true });

    if (isMobile(page)) {
      await expect(page.getByRole('tablist', { name: '表示の切り替え' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'キーワード' })).toHaveAttribute('aria-selected', 'true');
      await expect(tree(page)).toBeVisible();
      await expect(listHeading).toBeHidden();
      await expectNoHorizontalScroll(page);
      await showTab(page, '問題');
      await expect(listHeading).toBeVisible();
      await expect(tree(page)).toBeHidden();
      await expect(totalText(page)).toHaveText(`${TOTAL} 件`);
      await expectNoHorizontalScroll(page);
      await showTab(page, 'キーワード');
      await expect(tree(page)).toBeVisible();
      await expect(listHeading).toBeHidden();
      // 編集画面も横スクロールしない
      await page.goto(`/catalog/${subjectId}/questions/${expectedOrder[0]}`);
      await expect(page.getByRole('heading', { level: 1, name: '問題の編集' })).toBeVisible();
      await expectNoHorizontalScroll(page);
    } else {
      await expect(page.getByRole('tablist', { name: '表示の切り替え' })).toBeHidden();
      await expect(tree(page)).toBeVisible();
      await expect(listHeading).toBeVisible();
      await expect(totalText(page)).toHaveText(`${TOTAL} 件`);
      const t = (await page.getByRole('tabpanel').filter({ has: tree(page) }).boundingBox())!;
      const l = (await page.getByRole('tabpanel').filter({ has: listHeading }).boundingBox())!;
      // 左に木、右に一覧の2列（同じ行に並ぶ）
      expect(t.x + t.width).toBeLessThanOrEqual(l.x);
      expect(Math.abs(t.y - l.y)).toBeLessThan(2);
      expect(l.width).toBeGreaterThan(t.width);
      await expectNoHorizontalScroll(page);
    }
  });

  test.describe('キーボード操作と操作領域', () => {
    let kbSubjectId: string;
    let kbSubjectName: string;
    const stem = 'キーボードの問題';
    const edited = 'キーボードで直した問題';

    test.beforeAll(async () => {
      kbSubjectId = await seedSubject('キーボード科目');
      kbSubjectName = `${PREFIX}-キーボード科目`;
      const p = await seedKeyword(kbSubjectId, '上位');
      const c = await seedKeyword(kbSubjectId, '下位', p);
      await seedQuestion(kbSubjectId, [c], stem);
    });

    test('キーボードだけで科目選択・木・一覧・編集と保存ができ、フォーカスにアウトラインが出る（9.4）', async ({
      page,
    }) => {
      await page.goto('/catalog');
      await expect(page.getByRole('heading', { level: 1, name: 'カタログ' })).toBeVisible();

      // 科目選択
      const subjectLink = page.getByRole('link', { name: kbSubjectName, exact: true });
      await tabTo(page, subjectLink);
      await expectFocusOutline(subjectLink);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/catalog/${kbSubjectId}$`));

      // モバイル幅のタブは矢印キーで切り替える
      const treeTab = page.getByRole('tab', { name: 'キーワード' });
      const listTab = page.getByRole('tab', { name: '問題' });
      if (isMobile(page)) {
        await tabTo(page, treeTab);
        await expectFocusOutline(treeTab);
        await page.keyboard.press('ArrowRight');
        await expect(listTab).toHaveAttribute('aria-selected', 'true');
        await expect(listTab).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(treeTab).toHaveAttribute('aria-selected', 'true');
      }

      // 木: 展開・移動・選択
      const top = treeItem(page, '上位');
      await tabTo(page, top);
      await expectFocusOutline(top);
      await page.keyboard.press('ArrowRight');
      await expect(top).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('ArrowDown');
      const child = treeItem(page, '下位');
      await expectFocusOutline(child);
      await page.keyboard.press('Enter');
      await expect(child).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(/keyword=/);

      if (isMobile(page)) {
        await tabTo(page, treeTab, true);
        await page.keyboard.press('ArrowRight');
        await expect(listTab).toHaveAttribute('aria-selected', 'true');
      }
      await expect(totalText(page)).toHaveText('1 件');

      // 一覧: 無効化（確認ダイアログ）と有効化
      const disableBtn = page.getByRole('button', { name: `「${stem}」を無効化` });
      await tabTo(page, disableBtn);
      await expectFocusOutline(disableBtn);
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '問題を無効化' });
      await expect(dialog).toBeVisible();
      await tabTo(page, dialog.getByLabel('無効化の理由（任意）'));
      await page.keyboard.type('キーボード');
      const confirm = dialog.getByRole('button', { name: '無効にする' });
      await tabTo(page, confirm);
      await expectFocusOutline(confirm);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const enableBtn = page.getByRole('button', { name: `「${stem}」を有効に戻す` });
      await tabTo(page, enableBtn);
      await expectFocusOutline(enableBtn);
      await page.keyboard.press('Enter');
      await expect(disableBtn).toBeVisible();

      // 編集画面の入力と保存
      const edit = page.getByRole('link', { name: `「${stem}」を編集` });
      await tabTo(page, edit);
      await expectFocusOutline(edit);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: '問題の編集' })).toBeVisible();
      const stemInput = page.getByRole('textbox', { name: '問題文', exact: true });
      await expect(stemInput).toHaveValue(stem);
      await tabTo(page, stemInput);
      await expectFocusOutline(stemInput);
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(edited);
      // 正解のラジオを矢印キーで移す
      const radio1 = page.getByRole('radio', { name: '選択肢 1 を正解にする' });
      await tabTo(page, radio1);
      await expectFocusOutline(radio1);
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('radio', { name: '選択肢 2 を正解にする' })).toBeChecked();
      const save = page.getByRole('button', { name: '保存', exact: true });
      await tabTo(page, save);
      await expectFocusOutline(save);
      await page.keyboard.press('Enter');
      // 選択肢が2個（原則6個）のため警告を確認して保存する
      const confirmSave = page.getByRole('button', { name: '警告を確認して保存' });
      await tabTo(page, confirmSave);
      await page.keyboard.press('Enter');
      await expect(page.getByText('保存済み')).toBeVisible();

      const q = await db.from('questions').select('id, stem').eq('subject_id', kbSubjectId).single();
      expect(q.error).toBeNull();
      expect(q.data?.stem).toBe(edited);
      const cs = await db
        .from('choices')
        .select('is_correct')
        .eq('question_id', q.data!.id)
        .is('removed_at', null)
        .order('position');
      expect(cs.data?.map((c) => c.is_correct)).toEqual([false, true]);
    });

    test('主要な操作要素（ボタン・リンク・ラジオ・木の項目・タブ）の操作領域が 44px 以上（9.4）', async ({ page }) => {
      const editLink = editLinks(page).first();
      await page.goto('/catalog');
      await expect(page.getByRole('link', { name: kbSubjectName, exact: true })).toBeVisible();
      expect(await expectTapTargets(page.locator('main'))).toBeGreaterThan(0);

      await page.goto(`/catalog/${kbSubjectId}`);
      await treeItem(page, '上位').locator(':scope > div > span').first().click();
      await selectKeyword(page, '下位');
      expect(await expectTapTargets(page.locator('main'))).toBeGreaterThan(0);
      await showTab(page, '問題');
      await expect(editLink).toBeVisible();
      await expectTapTargets(page.locator('main'));

      await editLink.click();
      await expect(page.getByRole('heading', { level: 1, name: '問題の編集' })).toBeVisible();
      await expect(page.getByRole('radio', { name: '選択肢 1 を正解にする' })).toBeVisible();
      await expectTapTargets(page.locator('main'));
      // ナビゲーション（PC はサイド、モバイルはメニュー）
      if (isMobile(page)) {
        await page.getByRole('button', { name: 'メニュー' }).click();
        await expect(page.getByRole('navigation', { name: '管理メニュー' })).toBeVisible();
      }
      expect(await expectTapTargets(page.locator('header, nav'))).toBeGreaterThan(0);
    });
  });
});

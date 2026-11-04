import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD, fillLogin, homeHeading, loginAsOwner, loginHeading } from './helpers';

// learning-stats（統計画面）の利用者経路の E2E。
// seed の「統計検証」「E2E 大量データ」は読むだけで書き換えない。
// 解答の反映の確認には、実行ごとに接頭辞付きの科目を作り、後片付けで消す（e2e/quiz-db.spec.ts の方式）。
// 画面操作の describe は desktop で、レスポンシブ・44px・ダークテーマは mobile と desktop の両方で実行する。

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EMAIL = 'other@example.com';
const OTHER_PASSWORD = 'other-password-local';
const STATS_SUBJECT = 'd0000000-0000-4000-8000-000000000001';
const BULK_SUBJECT = 'b0000000-0000-4000-8000-000000000001';
const kw = (n: number) => `d0000000-0000-4000-8000-00000000c${n}`;
const NAME_PREFIX = 'stats-e2e-';
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_ai-question-study';

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

// このファイルが作った科目（名前の接頭辞で特定）の解答・SRS・フラグを消し、科目ごと物理削除する。
// 解答の直接削除はトリガーで拒否されるため、postgres でトリガーを止めて消す。
function cleanupSubjects(): void {
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: `begin;
set local session_replication_role = replica;
create temp table t_q on commit drop as
  select q.id from public.questions q join public.subjects s on s.id = q.subject_id
  where s.owner_id = '${OWNER_ID}' and s.name like '${NAME_PREFIX}%';
delete from public.answers where question_id in (select id from t_q);
delete from public.srs_states where question_id in (select id from t_q);
delete from public.question_flags where question_id in (select id from t_q);
set local session_replication_role = origin;
delete from public.subjects where owner_id = '${OWNER_ID}' and name like '${NAME_PREFIX}%';
commit;`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

// PC 優先の画面操作の describe は desktop だけで実行する
function desktopOnly(): void {
  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', '画面操作の確認は desktop で実行する');
  });
}

// 区間ボタンの名前（bins.ts の binAccessibleLabel と件数）
function rateName(bin: number, count: number, unit = '問'): string {
  if (bin === -1) return `正答率 未出題: ${count}${unit}`;
  return `正答率 ${bin * 10}%以上${bin * 10 + 10}%${bin === 9 ? '以下' : '未満'}: ${count}${unit}`;
}
function countName(bin: number, count: number, unit = '問'): string {
  if (bin <= 1) return `出題 ${bin}回: ${count}${unit}`;
  return `出題 ${2 ** (bin - 1)}回以上${2 ** bin - 1}回以下: ${count}${unit}`;
}

const binButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

// 期待する件数（0 件を含む全区間）がボタンとして表示されていることを確かめる
async function expectBins(
  page: Page,
  rate: Record<number, number>,
  count: Record<number, number>,
  maxCountBin: number,
  unit = '問',
): Promise<void> {
  for (let bin = -1; bin <= 9; bin++) {
    await expect(binButton(page, rateName(bin, rate[bin] ?? 0, unit))).toBeVisible();
  }
  for (let bin = 0; bin <= maxCountBin; bin++) {
    await expect(binButton(page, countName(bin, count[bin] ?? 0, unit))).toBeVisible();
  }
}

async function openStats(page: Page, query = `subject=${STATS_SUBJECT}`): Promise<void> {
  await page.goto(`/stats?${query}`);
  await expect(page.getByRole('heading', { level: 1, name: '統計' })).toBeVisible();
}

const rangeSelect = (page: Page) => page.getByLabel('範囲', { exact: true });
const subjectSelect = (page: Page) => page.getByLabel('科目', { exact: true });
const targetButton = (page: Page, name: '設問' | 'キーワード') =>
  page.getByRole('group', { name: '集計対象' }).getByRole('button', { name, exact: true });
const listHeading = (page: Page) => page.getByRole('heading', { level: 2, name: /の(設問|キーワード)（\d+件）$/ });
const listItems = (page: Page) => listHeading(page).locator('xpath=ancestor::section[1]').getByRole('listitem');

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function expectFocusRing(target: Locator): Promise<void> {
  const outline = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);
}

/** Tab を押して target にフォーカスを移し、フォーカス表示があることを確かめる */
async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  const handle = await target.elementHandle();
  if (!handle) throw new Error('対象の要素がありません');
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await handle.evaluate((el) => el === document.activeElement)) {
      await expectFocusRing(target);
      return;
    }
  }
  throw new Error(`${max} 回の Tab で対象に届きませんでした`);
}

// ============================================================
// 導線と未ログイン・科目なし（1.1、1.6、1.7）
// ============================================================

test.describe('導線と前提', () => {
  test('学習区分の「統計」導線（PC はサイドナビ、モバイルは下部バー）から統計画面を開ける（1.1）', async ({
    page,
  }, testInfo) => {
    await loginAsOwner(page);
    const navName = testInfo.project.name === 'desktop' ? 'サイドナビゲーション' : '学習ナビゲーション';
    const nav = page.getByRole('navigation', { name: navName, exact: true });
    await nav.getByRole('link', { name: '統計', exact: true }).click();
    await expect(page).toHaveURL(/\/stats/);
    await expect(page.getByRole('heading', { level: 1, name: '統計' })).toBeVisible();
    // 未選択の科目は先頭の科目に置き換わる
    await expect(page).toHaveURL(/subject=[0-9a-f-]{36}/);
  });

  test('未ログインで統計画面を開くとログイン画面へ誘導される（1.6）', async ({ page }) => {
    await page.goto(`/stats?subject=${STATS_SUBJECT}`);
    await expect(loginHeading(page)).toBeVisible();
  });

  test('科目がない利用者には案内が表示される（1.7）', async ({ page }) => {
    await page.goto('/login');
    await fillLogin(page, OTHER_EMAIL, OTHER_PASSWORD);
    await expect(homeHeading(page)).toBeVisible();
    await page.goto('/stats');
    await expect(page.getByText('科目がありません。カタログで科目を作成してください')).toBeVisible();
    await expect(page.getByRole('heading', { name: '正答率の分布' })).toHaveCount(0);
  });
});

// ============================================================
// seed の期待値どおりの区間件数と範囲・対象（2.x、3.x）
// ============================================================

test.describe('区間件数と範囲・対象', () => {
  desktopOnly();
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  test('科目全体の設問の区間件数が seed どおりで、無効・削除を除き、未出題を別に表示する（2.1〜2.7、3.1〜3.3）', async ({
    page,
  }) => {
    await openStats(page);
    await expect(page.getByRole('heading', { name: '正答率の分布' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '出題回数の分布' })).toBeVisible();
    // 無効（e011）・削除（e012）を除いた 10 問
    await expect(page.getByText('対象 10 問', { exact: true })).toBeVisible();
    await expectBins(page, { [-1]: 1, 0: 2, 1: 1, 5: 1, 7: 1, 8: 1, 9: 3 }, { 0: 1, 1: 1, 2: 2, 3: 2, 4: 3, 7: 1 }, 7);
    // 未出題は区切り線の下に分けて表示する
    const rateSection = page.getByRole('heading', { name: '正答率の分布' }).locator('xpath=ancestor::section[1]');
    await expect(rateSection.locator('hr')).toHaveCount(1);
    await expect(rateSection.getByRole('list').last().getByRole('button')).toHaveAccessibleName(rateName(-1, 1));
  });

  test('途中ノードの範囲で配下の設問だけに絞り込まれる（1.3、2.3）', async ({ page }) => {
    await openStats(page);
    await rangeSelect(page).selectOption(kw(102));
    await expect(page).toHaveURL(new RegExp(`keyword=${kw(102)}`));
    await expect(page.getByText('対象 6 問', { exact: true })).toBeVisible();
    await expectBins(page, { 0: 1, 7: 1, 8: 1, 9: 3 }, { 1: 1, 3: 2, 4: 2, 7: 1 }, 7);
  });

  test('対象のない範囲では案内を表示する（2.7）', async ({ page }) => {
    await openStats(page);
    await rangeSelect(page).selectOption(kw(106));
    await expect(page.getByText('対象 0 問', { exact: true })).toBeVisible();
    await expect(page.getByText('この範囲には対象の設問がありません')).toBeVisible();
    await expect(page.getByRole('heading', { name: '正答率の分布' })).toHaveCount(0);
  });

  test('キーワードへ切り替えても範囲を保ち、問題のないキーワードを除く（3.4〜3.9）', async ({ page }) => {
    await openStats(page);
    await targetButton(page, 'キーワード').click();
    await expect(targetButton(page, 'キーワード')).toHaveAttribute('aria-pressed', 'true');
    // 問題が紐づく 5 件（未使用を含まない）
    await expect(page.getByText('対象 5 キーワード', { exact: true })).toBeVisible();
    await expectBins(page, { 2: 1, 9: 4 }, { 3: 1, 5: 1, 7: 1, 8: 2 }, 8, 'キーワード');
    // 未出題 0 件の区間は選べない
    await expect(binButton(page, rateName(-1, 0, 'キーワード'))).toBeDisabled();

    // 範囲を変えても対象はキーワードのまま
    await rangeSelect(page).selectOption(kw(102));
    await expect(page).toHaveURL(/target=keyword/);
    await expect(page.getByText('対象 3 キーワード', { exact: true })).toBeVisible();

    // 対象を設問へ戻しても範囲を保つ
    await targetButton(page, '設問').click();
    await expect(rangeSelect(page)).toHaveValue(kw(102));
    await expect(page.getByText('対象 6 問', { exact: true })).toBeVisible();

    // 問題のないキーワードの範囲は対象なし
    await rangeSelect(page).selectOption(kw(106));
    await targetButton(page, 'キーワード').click();
    await expect(page.getByText('対象 0 キーワード', { exact: true })).toBeVisible();
    await expect(page.getByText('この範囲には対象のキーワードがありません')).toBeVisible();
  });
});

// ============================================================
// 掘り下げ（5.x）
// ============================================================

test.describe('掘り下げ', () => {
  desktopOnly();
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  test('区間を選ぶと件数が一致する一覧が弱い順に表示され、編集画面へ移れる（5.1〜5.4、5.6）', async ({ page }) => {
    await openStats(page);
    await binButton(page, rateName(9, 3)).click();
    await expect(binButton(page, rateName(9, 3))).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { level: 2, name: '正答率 90〜100% の設問（3件）' })).toBeVisible();
    const items = listItems(page);
    await expect(items).toHaveCount(3);
    // 正答率の昇順: e002（90%）、e004（99%）、e003（100%）
    await expect(items.nth(0)).toContainText('正答 9 / 出題 10（90%）');
    await expect(items.nth(1)).toContainText('正答 99 / 出題 100（99%）');
    await expect(items.nth(2)).toContainText('正答 10 / 出題 10（100%）');

    // 出題回数の区間でも件数が一致する
    await binButton(page, countName(4, 3)).click();
    await expect(page.getByRole('heading', { level: 2, name: '出題回数 8〜15回 の設問（3件）' })).toBeVisible();
    await expect(items).toHaveCount(3);
    // 正答率の昇順: e010（13%）、e002（90%）、e003（100%）
    await expect(items.nth(0)).toContainText('（13%）');
    await expect(items.nth(2)).toContainText('（100%）');

    // 編集画面へ移り、戻ると一覧が復元される
    await items.nth(0).getByRole('link').click();
    await expect(page).toHaveURL(
      new RegExp(`/catalog/${STATS_SUBJECT}/questions/d0000000-0000-4000-8000-00000000e010`),
    );
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: '出題回数 8〜15回 の設問（3件）' })).toBeVisible();
  });

  test('キーワードの区間の一覧は経路と問題数を表示する（5.3）', async ({ page }) => {
    await openStats(page, `subject=${STATS_SUBJECT}&target=keyword`);
    await binButton(page, rateName(2, 1, 'キーワード')).click();
    await expect(page.getByRole('heading', { level: 2, name: '正答率 20〜30% のキーワード（1件）' })).toBeVisible();
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page).first()).toContainText('応用');
    await expect(listItems(page).first()).toContainText('問題 3 問・正答 1 / 出題 5（20%）');
  });

  test('閉じる・別区間・範囲や対象の変更で一覧が消え、0 件の区間は選べない（5.5、5.8）', async ({ page }) => {
    await openStats(page);
    await expect(binButton(page, rateName(2, 0))).toBeDisabled();
    await expect(binButton(page, countName(5, 0))).toBeDisabled();

    await binButton(page, rateName(9, 3)).click();
    await expect(listHeading(page)).toHaveText('正答率 90〜100% の設問（3件）');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(listHeading(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/bin=/);

    // 別の区間を選ぶと一覧が置き換わる
    await binButton(page, rateName(9, 3)).click();
    await binButton(page, rateName(0, 2)).click();
    await expect(listHeading(page)).toHaveText('正答率 0〜10% の設問（2件）');
    await expect(binButton(page, rateName(9, 3))).toHaveAttribute('aria-pressed', 'false');

    // 範囲の変更で閉じる
    await rangeSelect(page).selectOption(kw(102));
    await expect(page.getByText('対象 6 問', { exact: true })).toBeVisible();
    await expect(listHeading(page)).toHaveCount(0);

    // 対象の変更で閉じる
    await binButton(page, rateName(9, 3)).click();
    await expect(listHeading(page)).toHaveText('正答率 90〜100% の設問（3件）');
    await targetButton(page, 'キーワード').click();
    await expect(page.getByText('対象 3 キーワード', { exact: true })).toBeVisible();
    await expect(listHeading(page)).toHaveCount(0);

    // 科目の変更で閉じる
    await targetButton(page, '設問').click();
    await binButton(page, rateName(9, 3)).click();
    await expect(listHeading(page)).toBeVisible();
    await subjectSelect(page).selectOption({ label: 'E2E 出題テスト' });
    await expect(rangeSelect(page)).toHaveValue('');
    await expect(listHeading(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/bin=/);
  });

  test('URL の範囲・区間から同じ表示が復元され、不正な区間は未選択になる（1.4、1.5、5.7）', async ({ page }) => {
    await openStats(page, `subject=${STATS_SUBJECT}&keyword=${kw(102)}&metric=correctRate&bin=9`);
    await expect(rangeSelect(page)).toHaveValue(kw(102));
    await expect(page.getByRole('heading', { level: 2, name: '正答率 90〜100% の設問（3件）' })).toBeVisible();
    await expect(listItems(page)).toHaveCount(3);

    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: '正答率 90〜100% の設問（3件）' })).toBeVisible();

    // 0 件の区間は未選択に戻る
    await openStats(page, `subject=${STATS_SUBJECT}&metric=correctRate&bin=2`);
    await expect(page.getByText('対象 10 問', { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/bin=/);
    await expect(listHeading(page)).toHaveCount(0);

    // 不正な科目は先頭の科目に置き換わる
    await openStats(page, 'subject=not-a-uuid');
    await expect(page).toHaveURL(/subject=[0-9a-f-]{36}/);
    await expect(page.getByText(/^対象 \d+ 問$/)).toBeVisible();
  });
});

// ============================================================
// 大量データ・反映・失敗と再試行・読み込み中（5.1、6.1〜6.4）
// ============================================================

test.describe('取得と反映', () => {
  desktopOnly();
  test.beforeAll(() => cleanupSubjects());
  test.afterAll(() => cleanupSubjects());
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  test('1,050 問の科目で未出題の一覧が 1,050 行で重複しない（5.1、6.4）', async ({ page }) => {
    await openStats(page, `subject=${BULK_SUBJECT}`);
    await expect(page.getByText('対象 1050 問', { exact: true })).toBeVisible();
    await binButton(page, rateName(-1, 1050)).click();
    await expect(page.getByRole('heading', { level: 2, name: '正答率 未出題 の設問（1050件）' })).toBeVisible();
    const hrefs = await listItems(page)
      .getByRole('link')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs).toHaveLength(1050);
    expect(new Set(hrefs).size).toBe(1050);
  });

  test('解答すると再読み込みで統計に反映される（6.1）', async ({ page }) => {
    const owner = await ownerClient();
    try {
      const { data: s, error: e1 } = await owner
        .from('subjects')
        .insert({ name: `${NAME_PREFIX}${Date.now()}` })
        .select('id')
        .single();
      if (e1) throw e1;
      const subjectId = s.id as string;
      const { data: k, error: ek } = await owner
        .from('keywords')
        .insert({ subject_id: subjectId, parent_id: null, name: '反映' })
        .select('id')
        .single();
      if (ek) throw ek;
      const { data: qid, error: e2 } = await owner.rpc('save_question', {
        p: {
          id: null,
          subjectId,
          kind: 'keyword',
          stem: '統計の反映を確かめる問題',
          explanation: '解説',
          keywordIds: [k.id as string],
          choices: [
            { body: '正解', explanation: '解説1', isCorrect: true },
            { body: '誤答', explanation: '解説2', isCorrect: false },
          ],
        },
      });
      if (e2) throw e2;
      const { data: cs, error: e3 } = await owner.from('choices').select('id, is_correct').eq('question_id', qid);
      if (e3) throw e3;
      const correct = (cs as { id: string; is_correct: boolean }[]).find((c) => c.is_correct)!.id;

      await openStats(page, `subject=${subjectId}`);
      await expect(binButton(page, rateName(-1, 1))).toBeVisible();
      await expect(binButton(page, countName(0, 1))).toBeVisible();

      const { error: e4 } = await owner.rpc('record_answer', {
        p_client_answer_id: crypto.randomUUID(),
        p_question_id: qid,
        p_choice_id: correct,
        p_kind: 'normal',
      });
      if (e4) throw e4;

      await page.reload();
      await expect(binButton(page, rateName(9, 1))).toBeVisible();
      await expect(binButton(page, rateName(-1, 0))).toBeDisabled();
      await expect(binButton(page, countName(1, 1))).toBeVisible();
    } finally {
      await owner.auth.signOut();
    }
  });

  test('ヒストグラムの取得失敗でエラーと再試行を表示し、再試行で表示される（6.2）', async ({ page }) => {
    let failed = false;
    await page.route('**/rest/v1/rpc/stats_histograms*', async (route) => {
      if (failed) return route.continue();
      failed = true;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
    });
    await openStats(page);
    await expect(page.getByRole('alert')).toContainText('ヒストグラムの取得に失敗しました');
    await expect(page.getByRole('heading', { name: '正答率の分布' })).toHaveCount(0);
    await page.getByRole('button', { name: '再試行', exact: true }).click();
    await expect(page.getByText('対象 10 問', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('一覧の途中のページで失敗すると部分的な一覧を表示せず、再試行で全件を表示する（6.2、6.4）', async ({ page }) => {
    let calls = 0;
    await page.route('**/rest/v1/rpc/stats_bin_items*', async (route) => {
      calls += 1;
      // 1 回目の取得の 2 ページ目だけを失敗させる
      if (calls === 2) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' });
        return;
      }
      await route.continue();
    });
    await openStats(page, `subject=${BULK_SUBJECT}`);
    await binButton(page, rateName(-1, 1050)).click();
    await expect(page.getByRole('alert')).toContainText('区間の一覧の取得に失敗しました');
    await expect(listHeading(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /E2E 大量データの問題/ })).toHaveCount(0);
    await page.getByRole('button', { name: '再試行', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: '正答率 未出題 の設問（1050件）' })).toBeVisible();
    await expect(listItems(page)).toHaveCount(1050);
  });

  test('取得中は読み込み中を表示する（6.3）', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route('**/rest/v1/rpc/stats_histograms*', async (route) => {
      await gate;
      await route.continue();
    });
    await openStats(page);
    await expect(page.getByRole('status')).toHaveText('読み込み中…');
    await expect(page.getByRole('heading', { name: '正答率の分布' })).toHaveCount(0);
    release();
    await expect(page.getByText('対象 10 問', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});

// ============================================================
// レスポンシブ・アクセシビリティ・ダークテーマ（7.x）
// mobile（390×844）と desktop（1280×800）の両方で実行する。
// ============================================================

test.describe('レスポンシブとアクセシビリティ', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  test('横スクロールがなく、操作要素の操作領域が 44px 以上（7.1、7.2）', async ({ page }) => {
    await openStats(page, `subject=${STATS_SUBJECT}&metric=correctRate&bin=9`);
    await expect(listHeading(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    const main = page.locator('section').filter({ has: page.getByRole('heading', { level: 1, name: '統計' }) });
    const sizes = await main.locator('button, select, a').evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.textContent?.trim() ?? '', w: r.width, h: r.height };
        }),
    );
    expect(sizes.length).toBeGreaterThan(10);
    expect(sizes.filter((s) => s.w < 44 || s.h < 44)).toEqual([]);

    await targetButton(page, 'キーワード').click();
    await expect(page.getByText('対象 5 キーワード', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('キーボードだけで範囲・区間・閉じるに到達でき、フォーカスが見える（7.3、7.5）', async ({ page }) => {
    await openStats(page);
    await expect(page.getByText('対象 10 問', { exact: true })).toBeVisible();
    await tabTo(page, rangeSelect(page));
    await tabTo(page, targetButton(page, 'キーワード'));
    const bin9 = binButton(page, rateName(9, 3));
    await tabTo(page, bin9);
    await page.keyboard.press('Enter');
    await expect(listHeading(page)).toHaveText('正答率 90〜100% の設問（3件）');
    const close = page.getByRole('button', { name: '閉じる', exact: true });
    await tabTo(page, close);
    await page.keyboard.press('Enter');
    await expect(listHeading(page)).toHaveCount(0);
  });

  test('ダークテーマで背景と文字が切り替わり、ヒストグラムを表示する（7.6、7.7）', async ({ page }) => {
    const colors = () =>
      page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const bar = document.querySelector('.bg-primary');
        return {
          bgToken: getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim(),
          bg: body.backgroundColor,
          color: body.color,
          bar: bar ? getComputedStyle(bar).backgroundColor : null,
        };
      });
    await page.emulateMedia({ colorScheme: 'light' });
    await openStats(page);
    await expect(page.getByText('対象 10 問', { exact: true })).toBeVisible();
    const light = await colors();

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.getByRole('heading', { name: '正答率の分布' })).toBeVisible();
    const dark = await colors();
    await expectNoHorizontalScroll(page);

    expect(light.bgToken).toBe('#ffffff');
    expect(dark.bgToken).toBe('#0c0a09');
    expect(dark.bg).toBe('rgb(12, 10, 9)');
    expect(dark.color).not.toBe(light.color);
    expect(dark.bar).not.toBeNull();
    expect(dark.bar).not.toBe(dark.bg);
  });
});

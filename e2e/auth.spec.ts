import { expect, test } from '@playwright/test';

import { OWNER_EMAIL, OWNER_PASSWORD, clickLogout, fillLogin, homeHeading, loginAsOwner, loginHeading } from './helpers';

// 認証経路の E2E。ローカル Supabase（seed の所有者アカウント）に対して実行する。
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54521';
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

test.describe('認証経路', () => {
  test('seed アカウントでログインするとホームに到達する', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    await fillLogin(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(homeHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('誤パスワードではエラーを表示し、入力を保持する', async ({ page }) => {
    await page.goto('/login');
    await fillLogin(page, OWNER_EMAIL, 'wrong-password');
    await expect(page.getByRole('alert')).toHaveText('メールアドレスまたはパスワードが正しくありません');
    await expect(page.getByLabel('メールアドレス')).toHaveValue(OWNER_EMAIL);
    await expect(page.getByLabel('パスワード')).toHaveValue('wrong-password');
    await expect(page).toHaveURL(/\/login/);
  });

  // 保護ルートは現状ホームのみ（未知の URL はガード外の 404 になる）。
  // クエリとハッシュ付きのホームを直開きし、パス・クエリ・ハッシュがすべて復元されることで復帰を検証する。
  test('保護 URL を直開きするとログイン画面へ移り、ログイン後に元の URL へ戻る', async ({ page }) => {
    await page.goto('/?from=e2e#section');
    await expect(loginHeading(page)).toBeVisible();
    const loginUrl = new URL(page.url());
    expect(loginUrl.pathname).toBe('/login');
    expect(loginUrl.searchParams.get('redirect')).toBe('/?from=e2e#section');

    await fillLogin(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(homeHeading(page)).toBeVisible();
    const back = new URL(page.url());
    expect(back.pathname).toBe('/');
    expect(back.search).toBe('?from=e2e');
    expect(back.hash).toBe('#section');
  });

  test('再読み込みしてもセッションが維持される', async ({ page }) => {
    await loginAsOwner(page);
    await page.reload();
    await expect(homeHeading(page)).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('ログアウトするとログイン画面へ遷移し、保護画面に戻れない', async ({ page }) => {
    await loginAsOwner(page);
    await clickLogout(page);
    await expect(loginHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(loginHeading(page)).toBeVisible();
  });

  test('別タブでログアウトすると、もう一方のタブも保護画面から退出する', async ({ page, context }) => {
    await loginAsOwner(page);
    const other = await context.newPage();
    await other.goto('/');
    await expect(homeHeading(other)).toBeVisible();

    await clickLogout(page);
    await expect(loginHeading(page)).toBeVisible();

    await expect(loginHeading(other)).toBeVisible();
    await expect(homeHeading(other)).toHaveCount(0);
    await expect(other).toHaveURL(/\/login/);
  });

  test('ログイン済みでログイン画面を開くとホームへ遷移する', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto('/login');
    await expect(homeHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('新規登録 API は失敗し、そのアカウントではログインできない', async ({ page }) => {
    const email = `signup-${Date.now()}@example.com`;
    const password = 'signup-password-e2e';
    const res = await page.request.post(`${SUPABASE_URL}/auth/v1/signup`, {
      headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      data: { email, password },
    });
    expect(res.ok()).toBe(false);
    const body = (await res.json()) as { error_code?: string; code?: string | number };
    expect(body.error_code ?? body.code).toBe('signup_disabled');

    await page.goto('/login');
    await fillLogin(page, email, password);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(homeHeading(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
  });
});

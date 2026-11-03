import { expect, type Page } from '@playwright/test';

// E2E 共通の補助。ローカル Supabase の seed 所有者アカウントを使う。
export const OWNER_EMAIL = 'owner@example.com';
export const OWNER_PASSWORD = 'owner-password-local';

export const homeHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'ホーム' });
export const loginHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'ログイン' });

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

export async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await fillLogin(page, OWNER_EMAIL, OWNER_PASSWORD);
  await expect(homeHeading(page)).toBeVisible();
}

// PC 幅ではヘッダーに常時表示、モバイル幅ではメニュー内にあるログアウトを押す。
export async function clickLogout(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'メニュー' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'ログアウト' }).click();
}

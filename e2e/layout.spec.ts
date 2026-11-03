/// <reference lib="dom" />
// page.evaluate 内でブラウザの DOM API を参照するため、このファイルだけ dom の型を読み込む。
import { expect, test, type Page } from '@playwright/test';

import { homeHeading, loginAsOwner, loginHeading } from './helpers';

// 共通レイアウトと画面遷移の E2E（2.3、2.4、5.1〜5.4、6.6）。
// mobile（390×844）と desktop（1280×800）の両プロジェクトで実行し、幅固有の検証は project 名で切り替える。

const notFoundHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'ページが見つかりません' });
const sideNav = (page: Page) => page.getByRole('navigation', { name: 'サイドナビゲーション' });
const menuButton = (page: Page) => page.getByRole('button', { name: 'メニュー' });
const logoutButton = (page: Page) => page.getByRole('button', { name: 'ログアウト' });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe('モバイル幅のレイアウト', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'モバイル幅専用');
  });

  test('ログイン画面とホームで横スクロールが発生しない', async ({ page }) => {
    await page.goto('/login');
    await expect(loginHeading(page)).toBeVisible();
    await expectNoHorizontalScroll(page);

    await loginAsOwner(page);
    await expectNoHorizontalScroll(page);

    // メニューを開いた状態でも横にはみ出さない
    await menuButton(page).click();
    await expect(logoutButton(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('サイドナビとログアウトは隠れ、メニュー内のログアウトでログイン画面へ遷移する', async ({ page }) => {
    await loginAsOwner(page);
    await expect(sideNav(page)).toBeHidden();
    await expect(logoutButton(page)).toBeHidden();

    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
    await logoutButton(page).click();
    await expect(loginHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('PC 幅のレイアウト', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'PC 幅専用');
  });

  test('サイドナビとログアウトが常時表示され、メニューボタンは出ない', async ({ page }) => {
    await loginAsOwner(page);
    await expect(sideNav(page)).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();
    await expect(menuButton(page)).toBeHidden();

    // 再読み込み後も常時表示のまま
    await page.reload();
    await expect(homeHeading(page)).toBeVisible();
    await expect(sideNav(page)).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();

    await logoutButton(page).click();
    await expect(loginHeading(page)).toBeVisible();
  });
});

test.describe('画面遷移', () => {
  test('ログイン済みのホームは共通レイアウト内に表示される', async ({ page }) => {
    await loginAsOwner(page);
    await expect(page.getByRole('banner').getByRole('link', { name: 'AI 問題学習' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'ホーム' })).toBeVisible();
  });

  test('存在しない URL では 404 画面を表示し、ホームへの導線で戻れる', async ({ page }) => {
    await loginAsOwner(page);
    await page.goto('/no-such-page/deep');
    await expect(notFoundHeading(page)).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('link', { name: 'ホームへ戻る' }).click();
    await expect(homeHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  // 開発サーバー上での直開き・再読み込みを検証する。本番サブパスの 404.html 代替配信は CI のビルド検査で確認する。
  test('深いリンクを再読み込みしても同じ画面が表示される', async ({ page }) => {
    await page.goto('/no-such-page/deep?x=1');
    await expect(notFoundHeading(page)).toBeVisible();
    await page.reload();
    await expect(notFoundHeading(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/no-such-page/deep');

    await loginAsOwner(page);
    await page.goto('/?x=1');
    await expect(homeHeading(page)).toBeVisible();
    await page.reload();
    await expect(homeHeading(page)).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('?x=1');
  });

  test('Tab 操作でフォーカス中の要素に見えるフォーカス表示が出る', async ({ page }) => {
    await loginAsOwner(page);
    await page.locator('body').click({ position: { x: 1, y: 400 } });
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).toBeVisible();
    const style = await focused.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { outlineStyle: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth) };
    });
    expect(style.outlineStyle).not.toBe('none');
    expect(style.outlineWidth).toBeGreaterThanOrEqual(2);
  });
});

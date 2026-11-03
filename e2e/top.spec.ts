import { expect, test } from '@playwright/test';

// 実行基盤のサンプル: 開発サーバーのトップ画面を開けることだけを確認する（認証・DB 不要）
test('トップ画面を開ける', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AI 問題学習');
  await expect(page.locator('main')).toBeAttached();
});

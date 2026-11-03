import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// 実行基盤のサンプル: jsdom 環境と jest-dom matcher が共通 setup から有効になっていることを確認する
describe('ユニットテストの実行基盤', () => {
  it('jsdom で描画した要素に jest-dom matcher を使える', () => {
    render(<p>テスト基盤</p>);
    expect(screen.getByText('テスト基盤')).toBeInTheDocument();
  });
});

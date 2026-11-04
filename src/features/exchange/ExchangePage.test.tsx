// 入出力画面: タブの切替と状態の保持、取込の保持中の離脱確認（10.3、10.4、10.6）
import { useEffect, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { ExchangePage, type ImportPanelSlotProps } from './ExchangePage';

// jsdom の AbortSignal は Node の Request が受け付けないため、データルーターの遷移用に signal を外す。
class TestRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {};
    super(input, rest);
  }
}
vi.stubGlobal('Request', TestRequest);

function FakeImport({ onHoldingChange }: ImportPanelSlotProps) {
  const [text, setText] = useState('');
  useEffect(() => onHoldingChange(text !== ''), [text, onHoldingChange]);
  return (
    <label>
      取込ファイル
      <input value={text} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: '/exchange',
        element: (
          <>
            <Link to="/">ホームへ</Link>
            <ExchangePage
              exportPanel={<p>出力パネル</p>}
              renderImportPanel={(p) => <FakeImport {...p} />}
            />
          </>
        ),
      },
      { path: '/', element: <p>ホーム画面</p> },
    ],
    { initialEntries: ['/exchange'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('ExchangePage', () => {
  it('「出力」「取込」のタブを切り替え、取込の状態を保持する', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '出力' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('出力パネル')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: '取込' }));
    await user.type(screen.getByLabelText('取込ファイル'), 'a.json');
    await user.click(screen.getByRole('tab', { name: '出力' }));
    expect(screen.getByLabelText('取込ファイル')).not.toBeVisible();
    await user.click(screen.getByRole('tab', { name: '取込' }));
    expect(screen.getByLabelText('取込ファイル')).toHaveValue('a.json');
  });

  it('矢印キーでタブを移動する', async () => {
    const user = userEvent.setup();
    renderPage();
    screen.getByRole('tab', { name: '出力' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '取込' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '取込' })).toHaveAttribute('aria-selected', 'true');
  });

  it('保持がなければ確認なしで移動する', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'ホームへ' }));
    expect(await screen.findByText('ホーム画面')).toBeInTheDocument();
  });

  it('保持中は画面内の遷移を確認し、キャンセルへ初期フォーカス、Esc で閉じて留まる', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: '取込' }));
    await user.type(screen.getByLabelText('取込ファイル'), 'a.json');
    await user.click(screen.getByRole('link', { name: 'ホームへ' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('破棄');
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('取込ファイル')).toHaveValue('a.json');
    expect(screen.queryByText('ホーム画面')).not.toBeInTheDocument();
  });

  it('確定すると移動する', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: '取込' }));
    await user.type(screen.getByLabelText('取込ファイル'), 'a.json');
    await user.click(screen.getByRole('link', { name: 'ホームへ' }));
    await user.click(await screen.findByRole('button', { name: '破棄して移動' }));
    expect(await screen.findByText('ホーム画面')).toBeInTheDocument();
  });

  it('保持中はブラウザの離脱を確認する', async () => {
    const user = userEvent.setup();
    renderPage();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    await user.click(screen.getByRole('tab', { name: '取込' }));
    await user.type(screen.getByLabelText('取込ファイル'), 'a.json');
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
  });
});

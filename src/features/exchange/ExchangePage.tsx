import { useCallback, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { useBlocker } from 'react-router';

import { ExchangeConfirmDialog } from './ExchangeConfirmDialog';

/** 取込パネルへ渡す口。取込ファイルかプレビューを保持している間は true を通知する（10.6） */
export type ImportPanelSlotProps = {
  onHoldingChange: (holding: boolean) => void;
};

type Props = {
  /** 出力パネル（3.2 の ExportPanel） */
  exportPanel?: ReactNode;
  /** 取込パネル（3.4 の ImportPanel） */
  renderImportPanel?: (props: ImportPanelSlotProps) => ReactNode;
};

type Tab = 'export' | 'import';

const TABS: { key: Tab; label: string }[] = [
  { key: 'export', label: '出力' },
  { key: 'import', label: '取込' },
];

/**
 * 入出力画面。「出力」「取込」のタブを持ち、非表示のパネルも描画したままにしてタブの切替で状態を保持する。
 * 取込の保持中は画面内の遷移と画面の離脱を確認する（10.3、10.4、10.6）。
 */
export function ExchangePage({ exportPanel = null, renderImportPanel }: Props): ReactElement {
  const baseId = useId();
  const tabId = (t: Tab) => `${baseId}-tab-${t}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t}`;
  const [tab, setTab] = useState<Tab>('export');
  const [holding, setHolding] = useState(false);
  const onHoldingChange = useCallback((h: boolean) => setHolding(h), []);

  // 画面内の遷移（10.6）
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        holding && currentLocation.pathname !== nextLocation.pathname,
      [holding],
    ),
  );

  // ブラウザの離脱（10.6）
  useEffect(() => {
    if (!holding) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [holding]);

  return (
    <section className="flex min-w-0 flex-col gap-4 break-words">
      <h1 className="text-xl font-bold">入出力</h1>
      <div role="tablist" aria-label="入出力の切り替え" className="flex min-w-0 flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={tabId(t.key)}
            aria-controls={panelId(t.key)}
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next: Tab = t.key === 'export' ? 'import' : 'export';
                setTab(next);
                document.getElementById(tabId(next))?.focus();
              }
            }}
            className={`tap-target focus-ring min-w-0 flex-1 rounded border px-3 lg:flex-none lg:px-6 ${
              tab === t.key ? 'border-primary bg-primary font-bold text-bg' : 'border-border'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={panelId(t.key)}
          aria-labelledby={tabId(t.key)}
          hidden={tab !== t.key}
          className="min-w-0 break-words"
        >
          {t.key === 'export' ? exportPanel : renderImportPanel?.({ onHoldingChange })}
        </div>
      ))}
      <ExchangeConfirmDialog
        open={blocker.state === 'blocked'}
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </section>
  );
}

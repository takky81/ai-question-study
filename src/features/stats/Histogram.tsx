// 横棒ヒストグラム: 区間ごとのボタンの縦の列（2.1、2.2、2.5、3.1、3.2、3.6、4.4、4.5、5.8、7.1〜7.5）。
// 色は primary／text-muted／border／text のトークンだけを使い、正誤・警告の色を使わない。
import type { ReactElement } from 'react';

import { barRatio, binAccessibleLabel, UNATTEMPTED_BIN } from './bins';
import type { Histogram as HistogramData, StatsMetric } from './types';

type Props = {
  title: string;
  histogram: HistogramData;
  unit: string;
  selectedBin: number | null;
  onSelect: (bin: number) => void;
};

type RowProps = {
  metric: StatsMetric;
  bin: number;
  label: string;
  count: number;
  maxCount: number;
  unit: string;
  selected: boolean;
  muted: boolean;
  onSelect: (bin: number) => void;
};

function Row({ metric, bin, label, count, maxCount, unit, selected, muted, onSelect }: RowProps): ReactElement {
  const percent = barRatio(count, maxCount) * 100;
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-label={`${binAccessibleLabel(metric, bin)}: ${count}${unit}`}
        aria-pressed={selected}
        disabled={count === 0}
        onClick={() => onSelect(bin)}
        className={`tap-target focus-ring flex w-full min-w-0 items-center gap-2 rounded border-2 px-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
          selected ? 'border-text font-bold' : 'border-transparent'
        }`}
      >
        <span className="w-[6.5rem] shrink-0 break-words">{label}</span>
        <span className="h-3 min-w-0 flex-1 rounded bg-border" aria-hidden="true">
          <span
            className={`block h-full rounded ${muted ? 'bg-text-muted' : 'bg-primary'}`}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="w-12 shrink-0 text-right tabular-nums">{count}</span>
      </button>
    </li>
  );
}

export function Histogram({ title, histogram, unit, selectedBin, onSelect }: Props): ReactElement {
  const { metric, bins, unattempted } = histogram;
  const maxCount = Math.max(0, ...bins.map((b) => b.count), unattempted ?? 0);
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-base font-bold">{title}</h2>
      <ul className="flex min-w-0 flex-col gap-1">
        {bins.map((b) => (
          <Row
            key={b.bin}
            metric={metric}
            bin={b.bin}
            label={b.label}
            count={b.count}
            maxCount={maxCount}
            unit={unit}
            selected={selectedBin === b.bin}
            muted={false}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {unattempted !== null && (
        <>
          <hr className="border-border" />
          <ul className="flex min-w-0 flex-col gap-1">
            <Row
              metric={metric}
              bin={UNATTEMPTED_BIN}
              label="未出題"
              count={unattempted}
              maxCount={maxCount}
              unit={unit}
              selected={selectedBin === UNATTEMPTED_BIN}
              muted
              onSelect={onSelect}
            />
          </ul>
        </>
      )}
    </section>
  );
}

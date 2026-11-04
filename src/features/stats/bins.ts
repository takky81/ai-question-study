// 区間のラベル、ヒストグラムの組み立て、棒の比率（2.5、2.6、3.6、3.7、4.1〜4.5、7.4）。
// 区間番号の意味は SQL の stats_private.rate_bin／count_bin と同時に変える。
import type {
  Histogram,
  HistogramBin,
  StatsHistograms,
  StatsMetric,
  StatsTarget,
} from "./types";

export const UNATTEMPTED_BIN = -1;
const RATE_BIN_COUNT = 10;
const MIN_BAR_RATIO = 0.02;

export type HistogramRow = {
  target: StatsTarget;
  metric: StatsMetric;
  bin: number;
  itemCount: number;
};

// 出題回数の区間 k（k >= 1）の下限と上限: 2^(k-1)〜2^k-1
function countRange(bin: number): [number, number] {
  return [2 ** (bin - 1), 2 ** bin - 1];
}

export function binLabel(metric: StatsMetric, bin: number): string {
  if (metric === "correctRate") {
    if (bin === UNATTEMPTED_BIN) return "未出題";
    return `${bin * 10}〜${bin * 10 + 10}%`;
  }
  if (bin <= 1) return `${bin}回`;
  const [lo, hi] = countRange(bin);
  return `${lo}〜${hi}回`;
}

export function binAccessibleLabel(metric: StatsMetric, bin: number): string {
  if (metric === "correctRate") {
    if (bin === UNATTEMPTED_BIN) return "正答率 未出題";
    const upper = bin === RATE_BIN_COUNT - 1 ? "以下" : "未満";
    return `正答率 ${bin * 10}%以上${bin * 10 + 10}%${upper}`;
  }
  if (bin <= 1) return `出題 ${bin}回`;
  const [lo, hi] = countRange(bin);
  return `出題 ${lo}回以上${hi}回以下`;
}

function buildOne(
  rows: readonly HistogramRow[],
  metric: StatsMetric,
): Histogram {
  const counts = new Map<number, number>();
  for (const r of rows)
    counts.set(r.bin, (counts.get(r.bin) ?? 0) + r.itemCount);
  const last =
    metric === "correctRate"
      ? RATE_BIN_COUNT - 1
      : Math.max(0, ...[...counts.keys()].filter((b) => b >= 0));
  const bins: HistogramBin[] = [];
  for (let bin = 0; bin <= last; bin++) {
    bins.push({
      bin,
      label: binLabel(metric, bin),
      count: counts.get(bin) ?? 0,
    });
  }
  const unattempted =
    metric === "correctRate" ? (counts.get(UNATTEMPTED_BIN) ?? 0) : null;
  const total = bins.reduce((sum, b) => sum + b.count, 0) + (unattempted ?? 0);
  return { metric, bins, unattempted, total };
}

export function buildHistograms(
  rows: readonly HistogramRow[],
): StatsHistograms {
  const pick = (target: StatsTarget, metric: StatsMetric) =>
    buildOne(
      rows.filter((r) => r.target === target && r.metric === metric),
      metric,
    );
  return {
    question: {
      correctRate: pick("question", "correctRate"),
      attemptCount: pick("question", "attemptCount"),
    },
    keyword: {
      correctRate: pick("keyword", "correctRate"),
      attemptCount: pick("keyword", "attemptCount"),
    },
  };
}

// 0〜1。0 件は 0、1 件以上は最小比率で 0 件と見分けられるようにする
export function barRatio(count: number, maxCount: number): number {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.max(MIN_BAR_RATIO, count / maxCount);
}

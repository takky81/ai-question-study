// 学習統計のドメイン型（2.1、3.1）。DB の metric 値との変換は api.ts で行う。
export type StatsTarget = 'question' | 'keyword';
export type StatsMetric = 'correctRate' | 'attemptCount';

export type HistogramBin = { bin: number; label: string; count: number };
export type Histogram = {
  metric: StatsMetric;
  bins: HistogramBin[]; // 区間の昇順（correctRate は 0〜9、attemptCount は 0〜最大）
  unattempted: number | null; // correctRate のみ。attemptCount は null
  total: number; // 区間の件数の合計 + unattempted
};
export type StatsHistograms = Record<StatsTarget, Record<StatsMetric, Histogram>>;

export type BinItem = {
  itemId: string;
  attemptCount: number;
  correctCount: number;
  correctRate: number | null; // 出題数 0 は null
  questionCount: number | null; // keyword のみ
  stem: string | null; // question のみ
};

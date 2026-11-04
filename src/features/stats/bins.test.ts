import { describe, expect, it } from "vitest";
import {
  barRatio,
  binAccessibleLabel,
  binLabel,
  buildHistograms,
  UNATTEMPTED_BIN,
  type HistogramRow,
} from "./bins";

describe("binLabel", () => {
  it("正答率: -1 は「未出題」、0〜8 は10%刻み、9 は「90〜100%」（2.5、4.1、4.5）", () => {
    expect(binLabel("correctRate", UNATTEMPTED_BIN)).toBe("未出題");
    expect(binLabel("correctRate", 0)).toBe("0〜10%");
    expect(binLabel("correctRate", 6)).toBe("60〜70%");
    expect(binLabel("correctRate", 8)).toBe("80〜90%");
    expect(binLabel("correctRate", 9)).toBe("90〜100%");
  });

  it("出題回数: 0回、1回、k>=2 は 2^(k-1)〜2^k-1回（4.2、4.5）", () => {
    expect(binLabel("attemptCount", 0)).toBe("0回");
    expect(binLabel("attemptCount", 1)).toBe("1回");
    expect(binLabel("attemptCount", 2)).toBe("2〜3回");
    expect(binLabel("attemptCount", 3)).toBe("4〜7回");
    expect(binLabel("attemptCount", 4)).toBe("8〜15回");
  });
});

describe("binAccessibleLabel", () => {
  it("正答率の境界を明示し、最後の区間は100%以下とする（7.4）", () => {
    expect(binAccessibleLabel("correctRate", 6)).toBe("正答率 60%以上70%未満");
    expect(binAccessibleLabel("correctRate", 0)).toBe("正答率 0%以上10%未満");
    expect(binAccessibleLabel("correctRate", 9)).toBe("正答率 90%以上100%以下");
    expect(binAccessibleLabel("correctRate", UNATTEMPTED_BIN)).toBe(
      "正答率 未出題",
    );
  });

  it("出題回数の境界を明示する（7.4）", () => {
    expect(binAccessibleLabel("attemptCount", 0)).toBe("出題 0回");
    expect(binAccessibleLabel("attemptCount", 1)).toBe("出題 1回");
    expect(binAccessibleLabel("attemptCount", 2)).toBe("出題 2回以上3回以下");
    expect(binAccessibleLabel("attemptCount", 3)).toBe("出題 4回以上7回以下");
  });
});

describe("buildHistograms", () => {
  const rows: HistogramRow[] = [
    {
      target: "question",
      metric: "correctRate",
      bin: UNATTEMPTED_BIN,
      itemCount: 2,
    },
    { target: "question", metric: "correctRate", bin: 3, itemCount: 4 },
    { target: "question", metric: "correctRate", bin: 9, itemCount: 1 },
    { target: "question", metric: "attemptCount", bin: 0, itemCount: 2 },
    { target: "question", metric: "attemptCount", bin: 3, itemCount: 5 },
    { target: "keyword", metric: "correctRate", bin: 0, itemCount: 1 },
    { target: "keyword", metric: "attemptCount", bin: 1, itemCount: 1 },
  ];

  it("正答率は 0〜9 の10区間を欠けなく 0 件で補い、未出題を区間から分ける（2.5、3.6、4.1、4.4）", () => {
    const h = buildHistograms(rows).question.correctRate;
    expect(h.metric).toBe("correctRate");
    expect(h.bins.map((b) => b.bin)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(h.bins.map((b) => b.count)).toEqual([0, 0, 0, 4, 0, 0, 0, 0, 0, 1]);
    expect(h.bins[3]?.label).toBe("30〜40%");
    expect(h.unattempted).toBe(2);
  });

  it("出題回数は 0 から最大の区間までを補い、未出題は null（4.2、4.4）", () => {
    const h = buildHistograms(rows).question.attemptCount;
    expect(h.bins.map((b) => [b.bin, b.count, b.label])).toEqual([
      [0, 2, "0回"],
      [1, 0, "1回"],
      [2, 0, "2〜3回"],
      [3, 5, "4〜7回"],
    ]);
    expect(h.unattempted).toBeNull();
  });

  it("合計は区間の件数と未出題の和で、指標どうしで一致する（2.6、3.7、4.3）", () => {
    const r = buildHistograms(rows);
    expect(r.question.correctRate.total).toBe(7);
    expect(r.question.attemptCount.total).toBe(7);
    expect(r.keyword.correctRate.total).toBe(1);
    expect(r.keyword.attemptCount.total).toBe(1);
    expect(r.keyword.correctRate.unattempted).toBe(0);
  });

  it("行がない対象は 0 件の区間で埋め、合計 0 にする（4.4）", () => {
    const r = buildHistograms([]);
    expect(r.keyword.correctRate.bins).toHaveLength(10);
    expect(r.keyword.correctRate).toMatchObject({ unattempted: 0, total: 0 });
    expect(r.keyword.attemptCount.bins).toEqual([
      { bin: 0, label: "0回", count: 0 },
    ]);
    expect(r.keyword.attemptCount.total).toBe(0);
  });

  it("入力を変更しない", () => {
    const copy = structuredClone(rows);
    buildHistograms(rows);
    expect(rows).toEqual(copy);
  });
});

describe("barRatio", () => {
  it("最大が 0 なら 0、0 件は 0、1 件以上は最小 0.02、最大は 1", () => {
    expect(barRatio(0, 0)).toBe(0);
    expect(barRatio(0, 10)).toBe(0);
    expect(barRatio(1, 1000)).toBe(0.02);
    expect(barRatio(5, 10)).toBe(0.5);
    expect(barRatio(10, 10)).toBe(1);
  });
});

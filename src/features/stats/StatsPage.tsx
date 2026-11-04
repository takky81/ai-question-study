// 統計画面: 範囲・対象の切り替え、取得、掘り下げのオーケストレーション（1.4、1.5、1.7、2.6、2.7、3.7〜3.9、5.1、5.4、5.5、5.7、6.3、7.1、7.6、7.7）。
// 状態は URL 検索パラメータを正とし、結果はキャッシュしない。
import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import type { Keyword, Subject } from '@/features/catalog/types';

import { getHistograms, listBinItems, listStatsKeywords, listStatsSubjects } from './api';
import { BinItemList } from './BinItemList';
import { binLabel, UNATTEMPTED_BIN } from './bins';
import { Histogram } from './Histogram';
import { sortBinItems } from './items';
import { parseStatsParams, toStatsParams, type StatsView } from './params';
import { RangeSelector } from './RangeSelector';
import type { BinItem, StatsHistograms, StatsMetric, StatsTarget } from './types';

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; value: T };
type Data = { key: string; keywords: Keyword[]; histograms: StatsHistograms; items: BinItem[] | null };

const BUTTON = 'tap-target focus-ring rounded border px-4';
const UNIT: Record<StatsTarget, string> = { question: '問', keyword: 'キーワード' };
const TARGET_NAMES: Record<StatsTarget, string> = { question: '設問', keyword: 'キーワード' };
const TARGETS: StatsTarget[] = ['question', 'keyword'];
const METRICS: StatsMetric[] = ['correctRate', 'attemptCount'];
const METRIC_TITLES: Record<StatsMetric, string> = { correctRate: '正答率の分布', attemptCount: '出題回数の分布' };
const METRIC_NAMES: Record<StatsMetric, string> = { correctRate: '正答率', attemptCount: '出題回数' };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// 取得の単位を URL 形式で表す。対象は一覧を開いているときだけ取得に影響する
function fetchKey(view: StatsView): string {
  return toStatsParams(view.selected ? view : { ...view, target: 'question' }).toString();
}

// URL の区間がヒストグラムに存在し 1 件以上あるか
function isSelectable(histograms: StatsHistograms, target: StatsTarget, metric: StatsMetric, bin: number): boolean {
  const h = histograms[target][metric];
  if (bin === UNATTEMPTED_BIN) return (h.unattempted ?? 0) > 0;
  return h.bins.some((b) => b.bin === bin && b.count > 0);
}

function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p role="alert" className="min-w-0 break-words text-warn">
        {message}
      </p>
      <button type="button" onClick={onRetry} className={`${BUTTON} border-border`}>
        再試行
      </button>
    </div>
  );
}

function Loading(): ReactElement {
  return (
    <p role="status" className="text-text-muted">
      読み込み中…
    </p>
  );
}

export function StatsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseStatsParams(searchParams);
  const [subjectsTry, setSubjectsTry] = useState(0);
  const [subjects, setSubjects] = useState<Load<Subject[]>>({ status: 'loading' });
  const [dataTry, setDataTry] = useState(0);
  const [data, setData] = useState<Load<Data>>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setSubjects({ status: 'loading' });
    listStatsSubjects().then(
      (value) => {
        if (active) setSubjects({ status: 'ok', value });
      },
      (e: unknown) => {
        if (active) setSubjects({ status: 'error', message: messageOf(e) });
      },
    );
    return () => {
      active = false;
    };
  }, [subjectsTry]);

  const subjectList = subjects.status === 'ok' ? subjects.value : null;
  const subjectValid = subjectList !== null && subjectList.some((s) => s.id === view.subjectId);
  const firstSubjectId = subjectList?.[0]?.id ?? null;

  // 未選択・不正な科目は先頭の科目に置き換える。科目が 0 件なら置き換えない（1.7）
  useEffect(() => {
    if (subjectList === null || subjectValid || firstSubjectId === null) return;
    setSearchParams(
      toStatsParams({ subjectId: firstSubjectId, keywordId: null, target: view.target, selected: null }),
      {
        replace: true,
      },
    );
  }, [subjectList, subjectValid, firstSubjectId, view.target, setSearchParams]);

  const key = subjectValid ? fetchKey(view) : null;

  // 範囲が決まるとキーワードとヒストグラムを、区間の選択中は一覧も同時に取得する（5.5、6.3）
  useEffect(() => {
    if (key === null) return;
    const v = parseStatsParams(new URLSearchParams(key));
    const subjectId = v.subjectId;
    if (subjectId === null) return;
    const sel = v.selected;
    // 範囲・区間を素早く変えたとき、古い応答は破棄する
    let active = true;
    setData({ status: 'loading' });
    Promise.all([
      listStatsKeywords(subjectId),
      getHistograms(subjectId, v.keywordId),
      sel ? listBinItems({ subjectId, keywordId: v.keywordId, target: v.target, ...sel }) : Promise.resolve(null),
    ]).then(
      ([keywords, histograms, items]) => {
        if (active)
          setData({ status: 'ok', value: { key, keywords, histograms, items: items && sortBinItems(items) } });
      },
      (e: unknown) => {
        if (active) setData({ status: 'error', message: messageOf(e) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, dataTry]);

  const current = data.status === 'ok' && data.value.key === key ? data.value : null;
  const keywordInvalid =
    current !== null && view.keywordId !== null && !current.keywords.some((k) => k.id === view.keywordId);
  const selectionInvalid =
    current !== null &&
    view.selected !== null &&
    !isSelectable(current.histograms, view.target, view.selected.metric, view.selected.bin);

  // 存在しないキーワードは科目全体に、範囲外・0 件の区間は未選択にする
  useEffect(() => {
    if (!keywordInvalid && !selectionInvalid) return;
    const next = parseStatsParams(searchParams);
    if (keywordInvalid) next.keywordId = null;
    next.selected = null;
    setSearchParams(toStatsParams(next), { replace: true });
  }, [keywordInvalid, selectionInvalid, searchParams, setSearchParams]);

  function update(patch: Partial<StatsView>) {
    setSearchParams(toStatsParams({ ...view, ...patch }));
  }

  const histograms = current !== null && !keywordInvalid ? current.histograms[view.target] : null;
  const total = histograms?.correctRate.total ?? 0;
  const unit = UNIT[view.target];
  const selected = selectionInvalid ? null : view.selected;

  return (
    <section className="mx-auto flex w-full min-w-0 max-w-[40rem] flex-col gap-4 break-words">
      <h1 className="text-xl font-bold">統計</h1>

      {subjects.status === 'loading' && <Loading />}
      {subjects.status === 'error' && (
        <ErrorRetry message={subjects.message} onRetry={() => setSubjectsTry((n) => n + 1)} />
      )}
      {subjectList !== null && subjectList.length === 0 && (
        <p className="text-text-muted">科目がありません。カタログで科目を作成してください</p>
      )}

      {subjectList !== null && subjectValid && view.subjectId !== null && (
        <>
          <RangeSelector
            subjects={subjectList}
            subjectId={view.subjectId}
            keywords={current?.keywords ?? []}
            keywordId={view.keywordId}
            onSubjectChange={(id) => {
              if (id !== view.subjectId) update({ subjectId: id, keywordId: null, selected: null });
            }}
            onKeywordChange={(id) => {
              if (id !== view.keywordId) update({ keywordId: id, selected: null });
            }}
          />
          <div role="group" aria-label="集計対象" className="flex min-w-0 gap-2">
            {TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={view.target === t}
                onClick={() => {
                  if (t !== view.target) update({ target: t, selected: null });
                }}
                className={`${BUTTON} min-w-0 flex-1 ${
                  view.target === t ? 'border-primary bg-primary font-bold text-bg' : 'border-border'
                }`}
              >
                {TARGET_NAMES[t]}
              </button>
            ))}
          </div>

          {data.status === 'error' && <ErrorRetry message={data.message} onRetry={() => setDataTry((n) => n + 1)} />}
          {data.status !== 'error' && histograms === null && <Loading />}
          {histograms !== null && current !== null && (
            <>
              <p>
                対象 {total} {unit}
              </p>
              {total === 0 ? (
                <p className="text-text-muted">この範囲には対象の{TARGET_NAMES[view.target]}がありません</p>
              ) : (
                METRICS.map((metric) => (
                  <Histogram
                    key={metric}
                    title={METRIC_TITLES[metric]}
                    histogram={histograms[metric]}
                    unit={unit}
                    selectedBin={selected?.metric === metric ? selected.bin : null}
                    onSelect={(bin) => update({ selected: { metric, bin } })}
                  />
                ))
              )}
              {selected !== null && current.items !== null && (
                <BinItemList
                  target={view.target}
                  title={`${METRIC_NAMES[selected.metric]} ${binLabel(selected.metric, selected.bin)} の${TARGET_NAMES[view.target]}`}
                  items={current.items}
                  subjectId={view.subjectId}
                  keywords={current.keywords}
                  onClose={() => update({ selected: null })}
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

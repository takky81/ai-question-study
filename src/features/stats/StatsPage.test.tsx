// 統計画面: 先頭科目への置き換え、科目なし、並列取得、対象の切り替え、対象なし、掘り下げ、閉じる、URL 復元、不正な区間、エラーと再試行、古い応答の破棄
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./api', () => ({
  listStatsSubjects: vi.fn(),
  listStatsKeywords: vi.fn(),
  getHistograms: vi.fn(),
  listBinItems: vi.fn(),
}));

import * as api from './api';
import { buildHistograms, type HistogramRow } from './bins';
import { StatsPage } from './StatsPage';
import type { BinItem, StatsHistograms } from './types';

const m = vi.mocked(api);
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const K1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Q1 = 'q1111111-1111-4111-8111-111111111111';
const Q2 = 'q2222222-2222-4222-8222-222222222222';

const subjects = [
  { id: S1, name: '基本情報', createdAt: '' },
  { id: S2, name: '応用情報', createdAt: '' },
];
const keywords = [{ id: K1, subjectId: S1, parentId: null, name: 'ネットワーク', sortOrder: 0 }];

function hist(rows: HistogramRow[]): StatsHistograms {
  return buildHistograms(rows);
}
// 設問 3 問（正答率 0 区間 2 問、未出題 1 問）、キーワード 1 個
const HIST = hist([
  { target: 'question', metric: 'correctRate', bin: 0, itemCount: 2 },
  { target: 'question', metric: 'correctRate', bin: -1, itemCount: 1 },
  { target: 'question', metric: 'attemptCount', bin: 0, itemCount: 1 },
  { target: 'question', metric: 'attemptCount', bin: 1, itemCount: 2 },
  { target: 'keyword', metric: 'correctRate', bin: 5, itemCount: 1 },
  { target: 'keyword', metric: 'attemptCount', bin: 2, itemCount: 1 },
]);
const EMPTY = hist([]);

function item(itemId: string, correctRate: number | null, attemptCount: number): BinItem {
  return { itemId, attemptCount, correctCount: 0, correctRate, questionCount: null, stem: `問題 ${itemId}` };
}

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="loc">{loc.search}</p>;
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/stats${search}`]}>
      <Routes>
        <Route
          path="/stats"
          element={
            <>
              <StatsPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const loc = () => new URLSearchParams(screen.getByTestId('loc').textContent ?? '');

beforeEach(() => {
  vi.resetAllMocks();
  m.listStatsSubjects.mockResolvedValue(subjects);
  m.listStatsKeywords.mockResolvedValue(keywords);
  m.getHistograms.mockResolvedValue(HIST);
  m.listBinItems.mockResolvedValue([]);
});

describe('StatsPage', () => {
  it('科目が未選択なら先頭の科目に置き換え、キーワードとヒストグラムを取得する', async () => {
    renderAt('');
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中…');
    expect(await screen.findByText('対象 3 問')).toBeInTheDocument();
    expect(loc().get('subject')).toBe(S1);
    expect(m.listStatsKeywords).toHaveBeenCalledWith(S1);
    expect(m.getHistograms).toHaveBeenCalledWith(S1, null);
    expect(screen.getByRole('heading', { name: '正答率の分布' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '出題回数の分布' })).toBeInTheDocument();
    expect(m.listBinItems).not.toHaveBeenCalled();
  });

  it('一覧にない科目は先頭の科目に置き換える', async () => {
    renderAt('?subject=33333333-3333-4333-8333-333333333333');
    await screen.findByText('対象 3 問');
    expect(loc().get('subject')).toBe(S1);
  });

  it('科目がなければ案内を表示し、ヒストグラムを取得しない', async () => {
    m.listStatsSubjects.mockResolvedValue([]);
    renderAt('');
    expect(await screen.findByText('科目がありません。カタログで科目を作成してください')).toBeInTheDocument();
    expect(m.getHistograms).not.toHaveBeenCalled();
  });

  it('対象を切り替えると範囲を保ってキーワードの対象数を表示し、一覧を閉じる', async () => {
    m.listBinItems.mockResolvedValue([item(Q1, 0, 3)]);
    renderAt(`?subject=${S1}&keyword=${K1}&metric=correctRate&bin=0`);
    expect(await screen.findByRole('heading', { name: /の設問（1件）/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'キーワード' }));
    expect(await screen.findByText('対象 1 キーワード')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キーワード' })).toHaveAttribute('aria-pressed', 'true');
    expect(loc().get('keyword')).toBe(K1);
    expect(loc().get('bin')).toBeNull();
    expect(screen.queryByRole('heading', { name: /件）/ })).not.toBeInTheDocument();
  });

  it('対象がなければヒストグラムの代わりに案内を表示する', async () => {
    m.getHistograms.mockResolvedValue(EMPTY);
    renderAt(`?subject=${S1}&target=keyword`);
    expect(await screen.findByText('この範囲には対象のキーワードがありません')).toBeInTheDocument();
    expect(screen.getByText('対象 0 キーワード')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '正答率の分布' })).not.toBeInTheDocument();
  });

  it('区間を選ぶと一覧とヒストグラムを同時に取り直し、弱い順に並べる', async () => {
    m.listBinItems.mockResolvedValue([item(Q2, 0.05, 2), item(Q1, 0, 3)]);
    renderAt(`?subject=${S1}`);
    await screen.findByText('対象 3 問');
    expect(m.getHistograms).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /正答率 0%以上10%未満/ }));
    expect(await screen.findByRole('heading', { name: '正答率 0〜10% の設問（2件）' })).toBeInTheDocument();
    expect(m.listBinItems).toHaveBeenCalledWith({
      subjectId: S1,
      keywordId: null,
      target: 'question',
      metric: 'correctRate',
      bin: 0,
    });
    expect(m.getHistograms).toHaveBeenCalledTimes(2);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent(`問題 ${Q1}`);
    expect(links[1]).toHaveTextContent(`問題 ${Q2}`);
    expect(loc().get('metric')).toBe('correctRate');
    expect(loc().get('bin')).toBe('0');
  });

  it('URL の区間で一覧を復元し、閉じると URL から外す', async () => {
    m.listBinItems.mockResolvedValue([item(Q1, null, 0)]);
    renderAt(`?subject=${S1}&metric=correctRate&bin=-1`);
    expect(await screen.findByRole('heading', { name: '正答率 未出題 の設問（1件）' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(loc().get('bin')).toBeNull());
    expect(screen.queryByRole('heading', { name: /件）/ })).not.toBeInTheDocument();
  });

  it('範囲を変えると一覧を閉じる', async () => {
    m.listBinItems.mockResolvedValue([item(Q1, 0, 1)]);
    renderAt(`?subject=${S1}&metric=correctRate&bin=0`);
    await screen.findByRole('heading', { name: /件）/ });
    await userEvent.selectOptions(screen.getByLabelText('範囲'), K1);
    await waitFor(() => expect(loc().get('keyword')).toBe(K1));
    expect(loc().get('bin')).toBeNull();
    await screen.findByText('対象 3 問');
    expect(screen.queryByRole('heading', { name: /件）/ })).not.toBeInTheDocument();
  });

  it('科目を変えると範囲と一覧を外す', async () => {
    renderAt(`?subject=${S1}&keyword=${K1}&metric=correctRate&bin=0`);
    await screen.findByRole('heading', { name: /件）/ });
    await userEvent.selectOptions(screen.getByLabelText('科目'), S2);
    await waitFor(() => expect(loc().get('subject')).toBe(S2));
    expect(loc().get('keyword')).toBeNull();
    expect(loc().get('bin')).toBeNull();
  });

  it.each([
    ['範囲外', '20'],
    ['0 件', '5'],
  ])('%s の区間は未選択として扱う', async (_, bin) => {
    renderAt(`?subject=${S1}&metric=correctRate&bin=${bin}`);
    await screen.findByText('対象 3 問');
    await waitFor(() => expect(loc().get('bin')).toBeNull());
    expect(screen.queryByRole('heading', { name: /件）/ })).not.toBeInTheDocument();
  });

  it('科目にないキーワードは科目全体として扱う', async () => {
    renderAt(`?subject=${S1}&keyword=dddddddd-dddd-4ddd-8ddd-dddddddddddd`);
    await waitFor(() => expect(loc().get('keyword')).toBeNull());
    await screen.findByText('対象 3 問');
    expect(m.getHistograms).toHaveBeenLastCalledWith(S1, null);
  });

  it('取得に失敗すると警告と再試行を表示し、一覧を部分的に表示しない', async () => {
    m.listBinItems.mockRejectedValueOnce(new Error('区間の一覧の取得に失敗しました: x'));
    renderAt(`?subject=${S1}&metric=correctRate&bin=0`);
    expect(await screen.findByRole('alert')).toHaveTextContent('区間の一覧の取得に失敗しました: x');
    expect(screen.queryByRole('heading', { name: '正答率の分布' })).not.toBeInTheDocument();
    m.listBinItems.mockResolvedValue([item(Q1, 0, 1)]);
    await userEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('heading', { name: /（1件）/ })).toBeInTheDocument();
  });

  it('科目の取得失敗は再試行できる', async () => {
    m.listStatsSubjects.mockRejectedValueOnce(new Error('科目の取得に失敗しました: x'));
    renderAt('');
    expect(await screen.findByRole('alert')).toHaveTextContent('科目の取得に失敗しました: x');
    await userEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByText('対象 3 問')).toBeInTheDocument();
  });

  it('科目を素早く変えたとき古い応答を破棄する', async () => {
    let resolveOld!: (h: StatsHistograms) => void;
    m.getHistograms.mockImplementation((s) =>
      s === S1 ? new Promise((r) => (resolveOld = r)) : Promise.resolve(HIST),
    );
    renderAt(`?subject=${S1}`);
    await waitFor(() => expect(m.getHistograms).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByLabelText('科目'), S2);
    expect(await screen.findByText('対象 3 問')).toBeInTheDocument();
    resolveOld(EMPTY);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('対象 3 問')).toBeInTheDocument();
  });
});

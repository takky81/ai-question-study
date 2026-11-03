import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, parseFilter, toSearchArgs, toSearchParams, type QuestionFilter } from './filters';

describe('parseFilter', () => {
  it('空のパラメータは既定値になる', () => {
    expect(parseFilter(new URLSearchParams())).toEqual({
      keywordId: null,
      kind: null,
      status: null,
      text: '',
      page: 1,
    });
    expect(DEFAULT_FILTER).toEqual(parseFilter(new URLSearchParams()));
  });

  it('正しい値を読み取る', () => {
    const p = new URLSearchParams('keyword=k1&kind=feature&status=disabled&q=%E8%AA%9E&page=3');
    expect(parseFilter(p)).toEqual({ keywordId: 'k1', kind: 'feature', status: 'disabled', text: '語', page: 3 });
  });

  it('不正値は既定値にする', () => {
    const p = new URLSearchParams('keyword=&kind=unknown&status=deleted&page=0');
    expect(parseFilter(p)).toEqual(DEFAULT_FILTER);
    for (const page of ['-2', '1.5', 'abc', '2x', '', '01']) {
      expect(parseFilter(new URLSearchParams({ page })).page).toBe(1);
    }
  });
});

describe('toSearchParams', () => {
  it('既定値は省略する', () => {
    expect(toSearchParams(DEFAULT_FILTER).toString()).toBe('');
  });

  it('URL との往復で同じ条件に戻る', () => {
    const filters: QuestionFilter[] = [
      { keywordId: 'k1', kind: 'keyword', status: 'active', text: '50% _ & =', page: 2 },
      { keywordId: null, kind: null, status: 'disabled', text: '', page: 1 },
      { keywordId: 'k2', kind: 'feature', status: null, text: ' 前後 ', page: 10 },
    ];
    for (const f of filters) {
      const url = toSearchParams(f).toString();
      expect(parseFilter(new URLSearchParams(url))).toEqual(f);
    }
  });
});

describe('toSearchArgs', () => {
  it('search_questions の引数へ変換し、未指定は null にする', () => {
    expect(toSearchArgs('s1', DEFAULT_FILTER)).toEqual({
      p_subject_id: 's1',
      p_keyword_id: null,
      p_kind: null,
      p_status: null,
      p_text: null,
    });
    expect(
      toSearchArgs('s1', { keywordId: 'k1', kind: 'feature', status: 'active', text: '語', page: 3 }),
    ).toEqual({ p_subject_id: 's1', p_keyword_id: 'k1', p_kind: 'feature', p_status: 'active', p_text: '語' });
  });
});

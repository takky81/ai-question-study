import { describe, expect, it } from 'vitest';
import { parseArgs, summarize } from './lint-import.ts';

describe('parseArgs', () => {
  it('入力だけなら <import>.lint.json に書く', () => {
    expect(parseArgs(['a/b.json'])).toEqual({ ok: true, input: 'a/b.json', out: 'a/b.lint.json' });
  });
  it('--out で出力先を変える', () => {
    expect(parseArgs(['b.json', '--out', 'x.json'])).toEqual({ ok: true, input: 'b.json', out: 'x.json' });
  });
  it('引数がない・--out の値がない・余分な引数は誤り', () => {
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(['b.json', '--out']).ok).toBe(false);
    expect(parseArgs(['b.json', 'c.json']).ok).toBe(false);
  });
});

describe('summarize', () => {
  it('点検数・警告のある問題数・種類ごとの件数を出す', () => {
    const text = summarize(3, [
      { ref: 'q1', warnings: [{ kind: 'containment', choiceIndex: 0, terms: ['a'] }] },
      {
        ref: 'q2',
        warnings: [
          { kind: 'containment', choiceIndex: 1, terms: ['b'] },
          { kind: 'full_name', choiceIndex: null, terms: ['CPI', 'Cycles Per Instruction'] },
        ],
      },
    ]);
    expect(text).toContain('点検 3 問');
    expect(text).toContain('警告 2 問');
    expect(text).toContain('containment: 2');
    expect(text).toContain('full_name: 1');
  });
});

import { describe, expect, it } from 'vitest';
import { exitCode, mergeResults, parseArgs, summarize } from './judge-import.ts';
import type { JudgeResult } from './judgeRunner.ts';

describe('parseArgs', () => {
  it('既定値', () => {
    expect(parseArgs(['a/b.json'])).toEqual({
      ok: true,
      input: 'a/b.json',
      out: 'a/b.judge.json',
      only: null,
      concurrency: 3,
      model: 'claude-haiku-5-5',
    });
  });
  it('すべてのオプション', () => {
    expect(parseArgs(['b.json', '--only', 'q1, q2', '--out', 'x.json', '--concurrency', '5', '--model', 'm'])).toEqual({
      ok: true,
      input: 'b.json',
      out: 'x.json',
      only: ['q1', 'q2'],
      concurrency: 5,
      model: 'm',
    });
  });
  it('誤り', () => {
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(['b.json', '--out']).ok).toBe(false);
    expect(parseArgs(['b.json', '--concurrency', '0']).ok).toBe(false);
    expect(parseArgs(['b.json', '--concurrency', 'x']).ok).toBe(false);
    expect(parseArgs(['b.json', '--only', '']).ok).toBe(false);
    expect(parseArgs(['b.json', 'c.json']).ok).toBe(false);
  });
});

const judged = (ref: string, guessable: boolean, cues: Array<'surface' | 'semantic'> = []): JudgeResult => ({
  ref,
  status: 'judged',
  guessable,
  cues,
  reason: '',
});

describe('mergeResults', () => {
  it('問題単位で上書きし、既存の順を保ち、新しいものは末尾', () => {
    const merged = mergeResults(
      [judged('a', false), judged('b', false)],
      [judged('b', true, ['surface']), judged('c', false)],
    );
    expect(merged.map((r) => r.ref)).toEqual(['a', 'b', 'c']);
    expect(merged[1]).toEqual(judged('b', true, ['surface']));
  });
});

describe('summarize と exitCode', () => {
  const results: JudgeResult[] = [
    judged('a', true, ['surface', 'semantic']),
    judged('b', true, ['semantic']),
    judged('c', false),
    { ref: 'd', status: 'unparsed', raw: 'x', order: [0], correctIndex: 0 },
    { ref: 'e', status: 'error', message: 'boom' },
  ];
  it('判定数・推測できる数・手がかり別・unparsed・エラー・トークンの目安', () => {
    const text = summarize(results, { calls: 4, tokens: 2000 });
    expect(text).toContain('判定 3 問');
    expect(text).toContain('推測できる 2 問');
    expect(text).toContain('surface: 1');
    expect(text).toContain('semantic: 2');
    expect(text).toContain('unparsed 1');
    expect(text).toContain('エラー 1');
    expect(text).toContain('約 400 トークン/問');
  });
  it('unparsed かエラーがあれば 2、なければ 0', () => {
    expect(exitCode(results)).toBe(2);
    expect(exitCode([judged('a', false)])).toBe(0);
  });
});

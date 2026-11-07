import { describe, expect, it } from 'vitest';
import { JUDGE_SYSTEM_PROMPT } from './blindJudge.ts';
import type { AuthoredQuestion } from './importModel.ts';
import { runJudges, type Invoke } from './judgeRunner.ts';

const mk = (ref: string, correct = 0): AuthoredQuestion => ({
  ref,
  kind: 'feature',
  stem: `問題${ref}`,
  explanation: '',
  choices: ['甲', '乙', '丙', '丁'].map((body, i) => ({
    body: `${body}${ref}`,
    explanation: '',
    isCorrect: i === correct,
  })),
});

// random = () => 0.99 なら Fisher–Yates で並びは変わらない（order = [0,1,2,3]）
const identity = () => 0.99;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('runJudges', () => {
  it('並列数を超えて同時に呼ばず、結果は入力順', async () => {
    let inFlight = 0;
    let max = 0;
    const pending: Array<() => void> = [];
    const invoke: Invoke = () => {
      inFlight++;
      max = Math.max(max, inFlight);
      return new Promise((resolve) => {
        pending.push(() => {
          inFlight--;
          resolve('{"surface":1,"semantic":null,"reason":"r"}');
        });
      });
    };
    const qs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((r) => mk(r));
    const done = runJudges(qs, invoke, 3, identity);
    for (let i = 0; i < 20; i++) {
      await flush();
      expect(inFlight).toBeLessThanOrEqual(3);
      pending.shift()?.();
    }
    const results = await done;
    expect(max).toBe(3);
    expect(results.map((r) => r.ref)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(results[0]).toEqual({ ref: 'a', status: 'judged', guessable: true, cues: ['surface'], reason: 'r' });
  });

  it('システムプロンプトと問題文を渡す', async () => {
    const calls: Array<[string, string]> = [];
    const invoke: Invoke = async (s, p) => {
      calls.push([s, p]);
      return '{"surface":null,"semantic":null,"reason":""}';
    };
    await runJudges([mk('a')], invoke, 1, identity);
    expect(calls[0]?.[0]).toBe(JUDGE_SYSTEM_PROMPT);
    expect(calls[0]?.[1]).toContain('問題a');
  });

  it('1問の失敗は error になり、他の問題は判定される', async () => {
    const invoke: Invoke = async (_s, p) => {
      if (p.includes('問題b')) throw new Error('boom');
      return '{"surface":2,"semantic":null,"reason":"r"}';
    };
    const results = await runJudges([mk('a'), mk('b'), mk('c')], invoke, 2, identity);
    expect(results[1]).toEqual({ ref: 'b', status: 'error', message: 'boom' });
    expect(results[0]).toMatchObject({ ref: 'a', status: 'judged', guessable: false });
    expect(results[2]).toMatchObject({ ref: 'c', status: 'judged', guessable: false });
  });

  it('読めない応答は1回だけ再実行し、読めれば判定する', async () => {
    let n = 0;
    const invoke: Invoke = async () => (n++ === 0 ? 'だめ' : '{"surface":null,"semantic":1,"reason":"r"}');
    const results = await runJudges([mk('a')], invoke, 1, identity);
    expect(n).toBe(2);
    expect(results[0]).toEqual({ ref: 'a', status: 'judged', guessable: true, cues: ['semantic'], reason: 'r' });
  });

  it('再実行しても読めなければ unparsed に生の応答・順序・正解の位置を残す', async () => {
    let n = 0;
    const invoke: Invoke = async () => `だめ${++n}`;
    const results = await runJudges([mk('a', 2)], invoke, 1, identity);
    expect(n).toBe(2);
    expect(results[0]).toEqual({ ref: 'a', status: 'unparsed', raw: 'だめ2', order: [0, 1, 2, 3], correctIndex: 2 });
  });
});

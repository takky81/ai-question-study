import { describe, expect, it } from 'vitest';
import { buildJudgeInput, interpret, JUDGE_SYSTEM_PROMPT, parseJudgeAnswer } from './blindJudge.ts';
import type { AuthoredQuestion } from './importModel.ts';

const question: AuthoredQuestion = {
  ref: 'q1',
  kind: 'feature',
  stem: '絵や音楽を創作した人に与えられる権利はどれか。',
  explanation: '解説本文ヒミツ',
  choices: [
    { body: '人権', explanation: '誤答解説A', isCorrect: false },
    { body: '著作権', explanation: '正解解説B', isCorrect: true },
    { body: '生存権', explanation: '誤答解説C', isCorrect: false },
    { body: '参政権', explanation: '誤答解説D', isCorrect: false },
  ],
};

// 決まった並びを作る乱数
const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe('JUDGE_SYSTEM_PROMPT', () => {
  it('2種類の手がかりと1行 JSON の出力を指示する', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('surface');
    expect(JUDGE_SYSTEM_PROMPT).toContain('semantic');
    expect(JUDGE_SYSTEM_PROMPT).toContain('reason');
  });

  it('知識で分かる答えを knowledge に分けさせる', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain('knowledge');
  });
});

describe('knowledge 欄', () => {
  it('knowledge が正解を指しても推測できるとしない', () => {
    const q = {
      ref: 'q',
      kind: 'keyword' as const,
      stem: 's',
      explanation: 'e',
      choices: [
        { body: 'A', explanation: 'x', isCorrect: true },
        { body: 'B', explanation: 'x', isCorrect: false },
      ],
    };
    const input = { prompt: '', order: [0, 1] };
    const answer = parseJudgeAnswer('{"knowledge":1,"surface":null,"semantic":null,"reason":"r"}', 2);
    expect(answer).not.toBeNull();
    expect(interpret(answer!, input, q).guessable).toBe(false);
  });
});

describe('buildJudgeInput', () => {
  it('問題文と番号付きの選択肢だけを含み、正解・解説・種別を含まない', () => {
    const input = buildJudgeInput(question, seq([0.1, 0.7, 0.3]));
    expect(input.prompt).toContain(question.stem);
    for (const c of question.choices) expect(input.prompt).toContain(c.body);
    for (const s of ['解説', 'ヒミツ', 'isCorrect', '正解', 'feature', 'true']) expect(input.prompt).not.toContain(s);
    expect(input.prompt).toMatch(/^1\. /m);
    expect(input.prompt).toMatch(/^4\. /m);
  });

  it('並べ替えの order で元の位置に戻せる', () => {
    const input = buildJudgeInput(question, seq([0.9, 0.0, 0.5]));
    expect([...input.order].sort()).toEqual([0, 1, 2, 3]);
    input.order.forEach((orig, pos) => {
      expect(input.prompt).toContain(`${pos + 1}. ${question.choices[orig]!.body}`);
    });
  });

  it('乱数によって並びが変わる', () => {
    const a = buildJudgeInput(question, () => 0).order;
    const b = buildJudgeInput(question, () => 0.99).order;
    expect(a).not.toEqual(b);
  });
});

describe('parseJudgeAnswer', () => {
  it('1行の JSON を読む', () => {
    expect(parseJudgeAnswer('{"surface":2,"semantic":null,"reason":"語が重なる"}', 4)).toEqual({
      surface: 2,
      semantic: null,
      reason: '語が重なる',
    });
  });

  it('前後の余分な文字やコードフェンスを許す', () => {
    const text = '回答です\n```json\n{"surface":null,"semantic":3,"reason":"意味"}\n```\n以上';
    expect(parseJudgeAnswer(text, 4)).toEqual({ surface: null, semantic: 3, reason: '意味' });
  });

  it('範囲外・整数でない番号や形の違いは null', () => {
    expect(parseJudgeAnswer('{"surface":5,"semantic":null,"reason":"x"}', 4)).toBeNull();
    expect(parseJudgeAnswer('{"surface":0,"semantic":null,"reason":"x"}', 4)).toBeNull();
    expect(parseJudgeAnswer('{"surface":1.5,"semantic":null,"reason":"x"}', 4)).toBeNull();
    expect(parseJudgeAnswer('{"surface":"1","semantic":null,"reason":"x"}', 4)).toBeNull();
    expect(parseJudgeAnswer('{"surface":1,"semantic":null}', 4)).toBeNull();
    expect(parseJudgeAnswer('{"surface":1,"reason":"x"}', 4)).toBeNull();
    expect(parseJudgeAnswer('わかりません', 4)).toBeNull();
    expect(parseJudgeAnswer('{broken', 4)).toBeNull();
  });
});

describe('interpret', () => {
  const input = { prompt: '', order: [2, 0, 3, 1] }; // 表示4番 = 元の1番（正解）

  it('手がかりが誤答を指すときは guessable: false', () => {
    const r = interpret({ surface: 1, semantic: 2, reason: 'r' }, input, question);
    expect(r).toEqual({ guessable: false, cues: [], reason: 'r' });
  });

  it('手がかりがないときは guessable: false', () => {
    expect(interpret({ surface: null, semantic: null, reason: '' }, input, question).guessable).toBe(false);
  });

  it('正解を指す手がかりの種類つきで true', () => {
    expect(interpret({ surface: null, semantic: 4, reason: 'r' }, input, question)).toEqual({
      guessable: true,
      cues: ['semantic'],
      reason: 'r',
    });
    expect(interpret({ surface: 4, semantic: 4, reason: 'r' }, input, question).cues).toEqual(['surface', 'semantic']);
    expect(interpret({ surface: 4, semantic: 1, reason: 'r' }, input, question).cues).toEqual(['surface']);
  });
});

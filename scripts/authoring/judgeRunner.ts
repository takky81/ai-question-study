import { buildJudgeInput, interpret, JUDGE_SYSTEM_PROMPT, parseJudgeAnswer, type CueKind } from './blindJudge.ts';
import type { AuthoredQuestion } from './importModel.ts';

export type Invoke = (systemPrompt: string, prompt: string) => Promise<string>; // モデルの応答本文

export type JudgeResult =
  | { ref: string; status: 'judged'; guessable: boolean; cues: CueKind[]; reason: string }
  | { ref: string; status: 'unparsed'; raw: string; order: number[]; correctIndex: number }
  | { ref: string; status: 'error'; message: string };

async function judgeOne(q: AuthoredQuestion, invoke: Invoke, random: () => number): Promise<JudgeResult> {
  const input = buildJudgeInput(q, random);
  try {
    let raw = '';
    // 読めない応答は1回だけ再実行する
    for (let attempt = 0; attempt < 2; attempt++) {
      raw = await invoke(JUDGE_SYSTEM_PROMPT, input.prompt);
      const answer = parseJudgeAnswer(raw, q.choices.length);
      if (answer) return { ref: q.ref, status: 'judged', ...interpret(answer, input, q) };
    }
    const correctIndex = q.choices.findIndex((c) => c.isCorrect);
    return { ref: q.ref, status: 'unparsed', raw, order: input.order, correctIndex };
  } catch (e) {
    return { ref: q.ref, status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// 同時に concurrency 件までしか呼ばない。結果は入力の順に並べる
export async function runJudges(
  questions: AuthoredQuestion[],
  invoke: Invoke,
  concurrency: number,
  random: () => number,
): Promise<JudgeResult[]> {
  const results: JudgeResult[] = new Array(questions.length);
  let next = 0;
  const worker = async () => {
    while (next < questions.length) {
      const i = next++;
      results[i] = await judgeOne(questions[i]!, invoke, random);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, questions.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

import { buildJudgeInput, interpret, JUDGE_SYSTEM_PROMPT, parseJudgeAnswer, type CueKind } from './blindJudge.ts';
import type { AuthoredQuestion } from './importModel.ts';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

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

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};
export type ClaudeCall = { command: string; args: string[]; env: Record<string, string | undefined>; cwd: string };
export type Spawner = (call: ClaudeCall, stdin: string) => Promise<{ code: number | null; stdout: string }>;

export function buildClaudeCall(
  model: string,
  systemPrompt: string,
  baseEnv: Record<string, string | undefined> = process.env,
  cwd: string = tmpdir(),
): ClaudeCall {
  return {
    command: 'claude',
    // prettier-ignore
    args: [
      '-p', '--model', model, '--effort', 'low', '--system-prompt', systemPrompt,
      '--tools', '', '--strict-mcp-config', '--setting-sources', '',
      '--no-session-persistence', '--output-format', 'json',
    ],
    env: { ...baseEnv, MAX_THINKING_TOKENS: '0', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    // CLAUDE.md を読ませないため、プロジェクトの外で実行する
    cwd,
  };
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

// CLI の出力 JSON から応答本文と使用量を取り出す。非0終了・is_error・壊れた出力は例外
export function parseClaudeOutput(stdout: string, code: number | null): { text: string; usage: Usage } {
  let out: unknown;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new Error(`claude の出力を読めない（終了コード ${String(code)}）: ${stdout.slice(0, 200)}`);
  }
  const o = (typeof out === 'object' && out !== null ? out : {}) as Record<string, unknown>;
  if (code !== 0 || o.is_error === true || typeof o.result !== 'string') {
    throw new Error(`claude が失敗した（終了コード ${String(code)}）: ${String(o.result ?? stdout.slice(0, 200))}`);
  }
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  const models = o.modelUsage;
  if (typeof models === 'object' && models !== null) {
    for (const m of Object.values(models as Record<string, Record<string, unknown> | null>)) {
      usage.inputTokens += num(m?.inputTokens);
      usage.outputTokens += num(m?.outputTokens);
      usage.cacheReadInputTokens += num(m?.cacheReadInputTokens);
      usage.cacheCreationInputTokens += num(m?.cacheCreationInputTokens);
    }
  }
  return { text: o.result, usage };
}

// 実際の子プロセス起動。Windows の claude は .exe なので shell なしで起動でき、空文字の引数もそのまま渡る
export const nodeSpawner: Spawner = (call, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(call.command, call.args, { cwd: call.cwd, env: call.env, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') }));
    child.stdin.end(stdin, 'utf8');
  });

// 1問ごとに新しい claude -p のプロセスを起動し、文脈を共有しない（13.1）
export function claudeInvoke(
  model: string,
  options: { spawner?: Spawner; onUsage?: (usage: Usage) => void } = {},
): Invoke {
  const spawner = options.spawner ?? nodeSpawner;
  return async (systemPrompt, prompt) => {
    const { code, stdout } = await spawner(buildClaudeCall(model, systemPrompt), prompt);
    const { text, usage } = parseClaudeOutput(stdout, code);
    options.onUsage?.(usage);
    return text;
  };
}

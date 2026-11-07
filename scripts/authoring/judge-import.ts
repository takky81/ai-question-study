// 取込用 JSON の作成・修正の問題を、1問ずつ claude -p で判定する CLI（要件 13.1、13.9、13.11）。
// 使い方: node scripts/authoring/judge-import.ts <import.json> [--only <ref,...>] [--out <path>] [--concurrency <n>] [--model <id>]
// unparsed・エラーが1件でもあれば終了コード 2。読めない・対応外のファイルや引数の誤りは 1。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractQuestions } from './importModel.ts';
import { claudeInvoke, runJudges, type JudgeResult } from './judgeRunner.ts';

export type Args =
  | { ok: true; input: string; out: string; only: string[] | null; concurrency: number; model: string }
  | { ok: false; error: string };
export type UsageTotal = { calls: number; tokens: number };

const USAGE =
  '使い方: node scripts/authoring/judge-import.ts <import.json> [--only <ref,...>] [--out <path>] [--concurrency <n>] [--model <id>]';

export function parseArgs(argv: string[]): Args {
  let input: string | undefined;
  let out: string | undefined;
  let only: string[] | null = null;
  let concurrency = 3;
  let model = 'claude-haiku-5-5';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out' || a === '--only' || a === '--concurrency' || a === '--model') {
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: `${a} に値がない\n${USAGE}` };
      if (a === '--out') out = v;
      else if (a === '--model') model = v;
      else if (a === '--only') {
        only = v
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        if (only.length === 0) return { ok: false, error: `--only に ref がない\n${USAGE}` };
      } else {
        concurrency = Number(v);
        if (!Number.isInteger(concurrency) || concurrency < 1)
          return { ok: false, error: `--concurrency は1以上の整数: ${v}\n${USAGE}` };
      }
    } else if (input === undefined) input = a;
    else return { ok: false, error: `余分な引数: ${a}\n${USAGE}` };
  }
  if (input === undefined) return { ok: false, error: USAGE };
  return { ok: true, input, out: out ?? input.replace(/(\.json)?$/i, '.judge.json'), only, concurrency, model };
}

// 既存の結果へ問題単位で上書きする。既存の順を保ち、新しい問題は末尾に足す
export function mergeResults(existing: JudgeResult[], fresh: JudgeResult[]): JudgeResult[] {
  const byRef = new Map(fresh.map((r) => [r.ref, r]));
  const known = new Set(existing.map((r) => r.ref));
  return [...existing.map((r) => byRef.get(r.ref) ?? r), ...fresh.filter((r) => !known.has(r.ref))];
}

export function summarize(results: JudgeResult[], usage: UsageTotal): string {
  const guessable = results.filter((r) => r.status === 'judged' && r.guessable);
  const judged = results.filter((r) => r.status === 'judged').length;
  const cue = (k: 'surface' | 'semantic') =>
    guessable.filter((r) => r.status === 'judged' && r.cues.includes(k)).length;
  const unparsed = results.filter((r) => r.status === 'unparsed').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const perQuestion = results.length > 0 ? Math.round(usage.tokens / results.length) : 0;
  return [
    `判定 ${judged} 問、推測できる ${guessable.length} 問`,
    `  surface: ${cue('surface')}`,
    `  semantic: ${cue('semantic')}`,
    `unparsed ${unparsed} 問、エラー ${errors} 問`,
    `トークン数の目安: 合計 ${usage.tokens}（呼び出し ${usage.calls} 回、約 ${perQuestion} トークン/問）`,
  ].join('\n');
}

export const exitCode = (results: JudgeResult[]): number =>
  results.some((r) => r.status === 'unparsed' || r.status === 'error') ? 2 : 0;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args.ok) {
    console.error(args.error);
    return 1;
  }
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(args.input, 'utf8'));
  } catch (e) {
    console.error(`ファイルを読めない: ${args.input}（${message(e)}）`);
    return 1;
  }
  const extracted = extractQuestions(file);
  if (!extracted.ok) {
    console.error(`対応外のファイル: ${extracted.error}`);
    return 1;
  }
  let targets = extracted.questions;
  let existing: JudgeResult[] = [];
  if (args.only) {
    const missing = args.only.filter((r) => !targets.some((q) => q.ref === r));
    if (missing.length > 0) {
      console.error(`取込用 JSON にない ref: ${missing.join(', ')}`);
      return 1;
    }
    const refs = new Set(args.only);
    targets = targets.filter((q) => refs.has(q.ref));
    if (existsSync(args.out)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(args.out, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error('配列ではない');
        existing = parsed as JudgeResult[];
      } catch (e) {
        console.error(`既存の結果を読めない: ${args.out}（${message(e)}）`);
        return 1;
      }
    }
  }
  const usage: UsageTotal = { calls: 0, tokens: 0 };
  const invoke = claudeInvoke(args.model, {
    onUsage: (u) => {
      usage.calls++;
      usage.tokens += u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
    },
  });
  const fresh = await runJudges(targets, invoke, args.concurrency, Math.random);
  const all = args.only ? mergeResults(existing, fresh) : fresh;
  try {
    writeFileSync(args.out, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  } catch (e) {
    console.error(`書き出せない: ${args.out}（${message(e)}）`);
    return 1;
  }
  console.log(summarize(fresh, usage));
  console.log(`結果: ${args.out}`);
  return exitCode(all);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

// 取込用 JSON の作成・修正の問題に推測の機械的な点検をかける CLI（要件 12.1〜12.9）。
// 使い方: node scripts/authoring/lint-import.ts <import.json> [--out <path>]
// 警告があっても終了コードは 0。読めない・対応外のファイルや引数の誤りのときだけ 1。
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractQuestions } from './importModel.ts';
import { lintQuestion, type LintWarning } from './guessLint.ts';

export type LintEntry = { ref: string; warnings: LintWarning[] };
export type Args = { ok: true; input: string; out: string } | { ok: false; error: string };

const USAGE = '使い方: node scripts/authoring/lint-import.ts <import.json> [--out <path>]';

export function parseArgs(argv: string[]): Args {
  let input: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      out = argv[++i];
      if (out === undefined) return { ok: false, error: `--out に出力先がない\n${USAGE}` };
    } else if (input === undefined) input = a;
    else return { ok: false, error: `余分な引数: ${a}\n${USAGE}` };
  }
  if (input === undefined) return { ok: false, error: USAGE };
  return { ok: true, input, out: out ?? input.replace(/(\.json)?$/i, '.lint.json') };
}

export function summarize(checked: number, entries: LintEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) for (const w of e.warnings) counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
  const lines = [`点検 ${checked} 問、警告 ${entries.length} 問`];
  for (const [kind, n] of counts) lines.push(`  ${kind}: ${n}`);
  return lines.join('\n');
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args.ok) {
    console.error(args.error);
    return 1;
  }
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(args.input, 'utf8'));
  } catch (e) {
    console.error(`ファイルを読めない: ${args.input}（${e instanceof Error ? e.message : String(e)}）`);
    return 1;
  }
  const extracted = extractQuestions(file);
  if (!extracted.ok) {
    console.error(`対応外のファイル: ${extracted.error}`);
    return 1;
  }
  const entries: LintEntry[] = extracted.questions
    .map((q) => ({ ref: q.ref, warnings: lintQuestion(q) }))
    .filter((e) => e.warnings.length > 0);
  try {
    writeFileSync(args.out, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  } catch (e) {
    console.error(`書き出せない: ${args.out}（${e instanceof Error ? e.message : String(e)}）`);
    return 1;
  }
  console.log(summarize(extracted.questions.length, entries));
  console.log(`結果: ${args.out}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}

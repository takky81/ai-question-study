// 問題生成 skill の契約（9.8、9.10、11.1〜11.11、12.1、12.9、13.6〜13.8、13.10）: ツール構成と必須の手順が SKILL.md にあることを照合する。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCHANGE_FORMAT, EXCHANGE_VERSION } from './format';

const skill = readFileSync(resolve(process.cwd(), '.claude/skills/question-authoring/SKILL.md'), 'utf8');
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';

describe('question-authoring SKILL.md', () => {
  it('frontmatter の名前とツール構成が Read／Write／Glob と点検・判定の2つのスクリプトだけ', () => {
    expect(frontmatter).toMatch(/^name: question-authoring$/m);
    expect(frontmatter).toMatch(/^description: .*source mode.*/m);
    expect(frontmatter).toMatch(
      /^allowed-tools: Read, Write, Glob, Bash\(node scripts\/authoring\/lint-import\.ts:\*\), Bash\(node scripts\/authoring\/judge-import\.ts:\*\)$/m,
    );
    expect(frontmatter.match(/Bash\(/g)).toHaveLength(2);
  });

  it('引数に出典モードを示す', () => {
    expect(frontmatter).toMatch(/^argument-hint: .*source=<text-path> range=<range>/m);
    expect(skill).toContain('`<export-json-path> source=<text-path> range=<range>`');
  });

  it('点検と判定のコマンドを両モードで実行する', () => {
    expect(skill).toContain('node scripts/authoring/lint-import.ts <import.json>');
    expect(skill).toContain('node scripts/authoring/judge-import.ts <import.json>');
    expect(skill).toContain('--only <refs>');
    expect(skill).toContain('`unparsed`');
    expect(skill).toMatch(/both modes/i);
  });

  it('作り直しを問題ごとに5回で打ち切る', () => {
    expect(skill).toMatch(/at most 5 rewrites per question/);
  });

  it.each([
    'term count',
    'keyword count',
    'question count',
    'terms not made',
    'non-term entries',
    'lint warnings',
    'judged count',
    'guessable count',
    'rewrite-count distribution',
    'unresolved questions',
    'unjudged questions',
  ])('報告に %s を含める', (item) => {
    expect(skill.toLowerCase()).toContain(item);
  });

  it('対応するフォーマットとバージョンを確認する', () => {
    expect(skill).toContain(EXCHANGE_FORMAT.export);
    expect(skill).toContain(`\`version\` is \`${EXCHANGE_VERSION}\``);
  });

  it.each(['guessable', 'low_value', 'needs_explanation', 'defective', 'comment'])(
    'フラグ %s の対処方針がある',
    (flag) => {
      expect(skill).toContain(`\`${flag}\``);
    },
  );

  it('書き出し先と出力日時の記録を定める', () => {
    expect(skill).toContain('.import.json');
    expect(skill).toContain('basedOnExportedAt');
  });
});

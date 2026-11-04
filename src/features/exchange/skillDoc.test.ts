// 問題生成 skill の契約（9.8、9.10）: ツール構成と必須の手順が SKILL.md にあることを照合する。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCHANGE_FORMAT, EXCHANGE_VERSION } from './format';

const skill = readFileSync(resolve(process.cwd(), '.claude/skills/question-authoring/SKILL.md'), 'utf8');
const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';

describe('question-authoring SKILL.md', () => {
  it('frontmatter の名前とツール構成が Read／Write／Glob だけ', () => {
    expect(frontmatter).toMatch(/^name: question-authoring$/m);
    expect(frontmatter).toMatch(/^description: .+/m);
    expect(frontmatter).toMatch(/^allowed-tools: Read, Write, Glob$/m);
  });

  it('対応するフォーマットとバージョンを確認する', () => {
    expect(skill).toContain(EXCHANGE_FORMAT.export);
    expect(skill).toContain(`\`version\` is \`${EXCHANGE_VERSION}\``);
  });

  it.each(['guessable', 'low_value', 'needs_explanation', 'defective', 'comment'])('フラグ %s の対処方針がある', (flag) => {
    expect(skill).toContain(`\`${flag}\``);
  });

  it('書き出し先と出力日時の記録を定める', () => {
    expect(skill).toContain('.import.json');
    expect(skill).toContain('basedOnExportedAt');
  });
});

// skill のフォーマット文書・例と format.ts／parse.ts の照合（3.9）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCHANGE_FORMAT, EXCHANGE_VERSION, EXPORT_FIELD_NAMES, IMPORT_FIELD_NAMES } from './format';
import { parseImportFile } from './parse';

const refDir = resolve(process.cwd(), '.claude/skills/question-authoring/references');
const doc = readFileSync(resolve(refDir, 'exchange-format.md'), 'utf8');
const example = readFileSync(resolve(refDir, 'example-import.json'), 'utf8');

describe('exchange-format.md', () => {
  it('フォーマット識別子とバージョンが現れる', () => {
    expect(doc).toContain(EXCHANGE_FORMAT.export);
    expect(doc).toContain(EXCHANGE_FORMAT.import);
    expect(doc).toContain(`"version": ${EXCHANGE_VERSION},`);
  });

  it.each([...IMPORT_FIELD_NAMES.map((n) => ['import', n]), ...EXPORT_FIELD_NAMES.map((n) => ['export', n])])(
    '%s の項目名 %s が現れる',
    (_kind, name) => {
      expect(doc).toContain(`\`${name}\``);
    },
  );

  it('解説の空文字と省略の規則を示す（15.1〜15.6）', () => {
    expect(doc).toMatch(/`""` means no explanation/);
    expect(doc).not.toContain('Give an explanation for the whole question and for every choice');
    expect(doc).toMatch(/Always explain every wrong choice/);
    expect(doc).toMatch(/in that choice's own explanation/);
  });

  it('未出題の条件 attempted が現れない（1.6）', () => {
    expect(doc).not.toContain('`attempted`');
  });
});

describe('example-import.json', () => {
  const result = parseImportFile(example);

  it('取込の検証を通る', () => {
    expect(result).toMatchObject({ ok: true });
  });

  it('すべての操作を1回以上含む', () => {
    if (!result.ok) throw new Error('parse failed');
    const { keywords, questions } = result.value;
    for (const list of [keywords.add, keywords.rename, keywords.move, questions.update, questions.create, questions.disable]) {
      expect(list.length).toBeGreaterThan(0);
    }
  });
});

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest は CSS の ?raw を空にするため、ファイルを直接読む
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

// index.css のテーマトークンを読み取り、WCAG コントラスト比を検証する（6.4）

/** 指定セレクタ直下のブロック本文を取り出す（最初の一致） */
function blockAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`見つからない: ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`閉じ括弧がない: ${marker}`);
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--c-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const light = tokens(blockAfter(css, ':root'));
const darkMedia = blockAfter(css, '@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(blockAfter(darkMedia, ':root')) };

const FG = ['--c-text', '--c-text-muted', '--c-correct', '--c-incorrect', '--c-warn'];
const BG = ['--c-bg', '--c-surface'];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('テーマ %s', (_name, t) => {
  it('必要なトークンがすべて定義されている', () => {
    for (const k of [...FG, ...BG, '--c-border', '--c-primary', '--c-correct-bg', '--c-incorrect-bg']) {
      expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(FG.flatMap((fg) => BG.map((bg) => [fg, bg])))('%s / %s が 4.5:1 以上', (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('正誤の印の薄い背景上でも本文・正誤色が 4.5:1 以上', () => {
    for (const [fg, bg] of [
      ['--c-correct', '--c-correct-bg'],
      ['--c-text', '--c-correct-bg'],
      ['--c-incorrect', '--c-incorrect-bg'],
      ['--c-text', '--c-incorrect-bg'],
    ] as const) {
      expect(contrast(t[fg]!, t[bg]!), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('正解・不正解・警告は別の値', () => {
    expect(new Set([t['--c-correct'], t['--c-incorrect'], t['--c-warn']]).size).toBe(3);
  });
});

describe('共通 class と Tailwind 公開', () => {
  it.each(['.focus-ring', '.tap-target', '.choice-selected', '.mark-correct', '.mark-incorrect'])(
    '%s が定義されている',
    (cls) => {
      expect(css).toContain(cls);
    },
  );

  it('正誤色と警告色が別のユーティリティとして公開されている', () => {
    const theme = blockAfter(css, '@theme inline');
    expect(theme).toContain('--color-correct: var(--c-correct)');
    expect(theme).toContain('--color-incorrect: var(--c-incorrect)');
    expect(theme).toContain('--color-warn: var(--c-warn)');
  });

  it('44px の操作領域', () => {
    const tap = blockAfter(css, '.tap-target');
    expect(tap).toMatch(/min-height:\s*44px/);
    expect(tap).toMatch(/min-width:\s*44px/);
  });
});

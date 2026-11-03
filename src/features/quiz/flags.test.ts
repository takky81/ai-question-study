import { describe, expect, it } from 'vitest';
import { CHECKBOX_FLAG_IDS, QUESTION_FLAGS, normalizeComment } from './flags';

describe('QUESTION_FLAGS', () => {
  it('識別子と表示名が product.md の「問題フラグ」の表と一致する', () => {
    expect(QUESTION_FLAGS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'guessable', label: '知識がなくても推測で解ける' },
      { id: 'low_value', label: '問う価値が低い' },
      { id: 'needs_explanation', label: '解説の内容を追加する' },
      { id: 'defective', label: '問題不備（正解・問題文の誤り、正解が一つに決まらない）' },
      { id: 'comment', label: '疑義の内容（自由入力）' },
    ]);
  });

  it('comment だけが自由入力で、他はチェックボックス', () => {
    expect(QUESTION_FLAGS.filter((f) => f.input === 'text').map((f) => f.id)).toEqual(['comment']);
  });
});

describe('CHECKBOX_FLAG_IDS', () => {
  it('チェック型の識別子を表の順に持ち、comment を含まない', () => {
    expect(CHECKBOX_FLAG_IDS).toEqual(['guessable', 'low_value', 'needs_explanation', 'defective']);
    expect(CHECKBOX_FLAG_IDS).not.toContain('comment');
  });
});

describe('normalizeComment', () => {
  it('前後の空白を除く', () => {
    expect(normalizeComment('  正解が2つある\n')).toBe('正解が2つある');
  });
  it('空や空白だけ（全角空白・改行を含む）は null', () => {
    expect(normalizeComment('')).toBeNull();
    expect(normalizeComment(' \t\n　')).toBeNull();
  });
  it('内部の空白は保持する', () => {
    expect(normalizeComment(' a  b ')).toBe('a  b');
  });
});

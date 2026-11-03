// 問題フラグの識別子と表示名。正本は .kiro/steering/product.md の「問題フラグ」（7.1、8.5）。
export const QUESTION_FLAGS = [
  { id: 'guessable', label: '知識がなくても推測で解ける', input: 'checkbox' },
  { id: 'low_value', label: '問う価値が低い', input: 'checkbox' },
  { id: 'needs_explanation', label: '解説の内容を追加する', input: 'checkbox' },
  { id: 'defective', label: '問題不備（正解・問題文の誤り、正解が一つに決まらない）', input: 'checkbox' },
  { id: 'comment', label: '疑義の内容（自由入力）', input: 'text' },
] as const;

export type QuestionFlagId = (typeof QUESTION_FLAGS)[number]['id'];
export type CheckboxFlagId = Exclude<QuestionFlagId, 'comment'>;
export type QuestionFlagStatus = 'open' | 'resolved';

export const CHECKBOX_FLAG_IDS: readonly CheckboxFlagId[] = QUESTION_FLAGS.flatMap((f) =>
  f.id === 'comment' ? [] : [f.id],
);

// 前後の空白を除き、空なら null（空白だけのコメントは記録しない: 7.5）。
export function normalizeComment(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

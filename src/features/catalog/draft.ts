// 編集中の問題の初期化と選択肢操作。すべて純粋関数で、入力は変更しない（4.4、4.5）。
import type { ChoiceInput, Question, QuestionInput, QuestionKind } from './types';
import { EXPECTED_CHOICE_COUNT } from './validate';

// 新しい選択肢は ID なし（保存時に挿入される）
function emptyChoice(): ChoiceInput {
  return { id: null, body: '', explanation: '', isCorrect: false };
}

function inRange(d: QuestionInput, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < d.choices.length;
}

// 種別ごとの原則数の空欄選択肢を持つ新規入力を作る
export function createDraft(subjectId: string, kind: QuestionKind): QuestionInput {
  return {
    id: null,
    subjectId,
    kind,
    stem: '',
    explanation: '',
    keywordIds: [],
    choices: Array.from({ length: EXPECTED_CHOICE_COUNT[kind] }, emptyChoice),
  };
}

// 既存問題を編集用の入力へ変換する（問題・選択肢の ID と表示順を保つ）
export function fromQuestion(q: Question): QuestionInput {
  return {
    id: q.id,
    subjectId: q.subjectId,
    kind: q.kind,
    stem: q.stem,
    explanation: q.explanation,
    keywordIds: [...q.keywordIds],
    choices: q.choices.map((c) => ({ id: c.id, body: c.body, explanation: c.explanation, isCorrect: c.isCorrect })),
  };
}

export function addChoice(d: QuestionInput): QuestionInput {
  return { ...d, choices: [...d.choices, emptyChoice()] };
}

// 範囲外の位置では内容を変えない
export function removeChoice(d: QuestionInput, index: number): QuestionInput {
  if (!inRange(d, index)) return { ...d, choices: [...d.choices] };
  return { ...d, choices: d.choices.filter((_, i) => i !== index) };
}

export function moveChoice(d: QuestionInput, from: number, to: number): QuestionInput {
  const choices = [...d.choices];
  if (!inRange(d, from) || !inRange(d, to)) return { ...d, choices };
  const [moved] = choices.splice(from, 1);
  choices.splice(to, 0, moved!);
  return { ...d, choices };
}

// 指定の選択肢だけを正解にし、他を false にする
export function setCorrect(d: QuestionInput, index: number): QuestionInput {
  if (!inRange(d, index)) return { ...d, choices: [...d.choices] };
  return { ...d, choices: d.choices.map((c, i) => ({ ...c, isCorrect: i === index })) };
}

function sameChoice(a: ChoiceInput, b: ChoiceInput): boolean {
  return a.id === b.id && a.body === b.body && a.explanation === b.explanation && a.isCorrect === b.isCorrect;
}

// 保存内容に差があるかを判定する。紐づけは集合として比べる
export function isDirty(original: QuestionInput, current: QuestionInput): boolean {
  if (
    original.id !== current.id ||
    original.subjectId !== current.subjectId ||
    original.kind !== current.kind ||
    original.stem !== current.stem ||
    original.explanation !== current.explanation
  ) {
    return true;
  }
  const a = [...new Set(original.keywordIds)].sort();
  const b = [...new Set(current.keywordIds)].sort();
  if (a.length !== b.length || a.some((id, i) => id !== b[i])) return true;
  if (original.choices.length !== current.choices.length) return true;
  return original.choices.some((c, i) => !sameChoice(c, current.choices[i]!));
}

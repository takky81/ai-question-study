// 作問ルールの検証（純粋関数）。手動編集と取込（question-exchange）で共有する（5.1）。
// 「1問1情報」は機械的に判定できないため検証しない（生成 skill と人のレビューの責務）。
import type { QuestionInput, QuestionKind } from './types';

export const EXPECTED_CHOICE_COUNT: Record<QuestionKind, number> = { keyword: 6, feature: 4 };

export type ValidationCode =
  | 'correct_count'
  | 'required'
  | 'too_few_choices'
  | 'duplicate_choice'
  | 'duplicate_choice_id'
  | 'no_keyword'
  | 'foreign_keyword'
  | 'choice_count_below'
  | 'choice_count_above'
  | 'abbreviation_unexplained'
  | 'wrong_choice_unexplained';

export type ValidationTarget =
  | { field: 'stem' | 'explanation' | 'keywords' | 'choices' }
  | { field: 'choiceBody' | 'choiceExplanation'; index: number };

export type ValidationIssue = {
  code: ValidationCode;
  severity: 'error' | 'warning';
  target: ValidationTarget;
  message: string; // 日本語
};

const KIND_LABEL: Record<QuestionKind, string> = {
  keyword: 'キーワードを答える問題',
  feature: '特徴などを答える問題',
};

// 英大文字で始まる2文字以上の語（英大文字・数字のみ）
const ABBREVIATION = /\b[A-Z][A-Z0-9]+\b/g;

function abbreviations(text: string): string[] {
  return [...new Set(text.match(ABBREVIATION) ?? [])];
}

const isBlank = (s: string) => s.trim() === '';

export function validateQuestion(
  input: QuestionInput,
  context: { subjectKeywordIds: ReadonlySet<string> },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: ValidationCode, target: ValidationTarget, message: string) =>
    issues.push({ code, severity: 'error', target, message });
  const warning = (code: ValidationCode, target: ValidationTarget, message: string) =>
    issues.push({ code, severity: 'warning', target, message });
  const { choices } = input;

  // 5.2 正解は1つ
  const correct = choices.filter((c) => c.isCorrect).length;
  if (correct !== 1) {
    error('correct_count', { field: 'choices' }, `正解の選択肢はちょうど1つにしてください（現在 ${correct} 個）。`);
  }

  // 5.3 空欄（解説は任意。誤答の解説の空欄は 5.11 の警告）
  if (isBlank(input.stem)) error('required', { field: 'stem' }, '問題文を入力してください。');
  choices.forEach((c, index) => {
    if (isBlank(c.body)) {
      error('required', { field: 'choiceBody', index }, `選択肢 ${index + 1} の本文を入力してください。`);
    }
  });

  // 5.4 選択肢2個未満
  if (choices.length < 2) {
    error('too_few_choices', { field: 'choices' }, '選択肢は2個以上必要です。');
  }

  // 5.4 本文の重複（前後空白を除いて比較。空欄は required で報告する）
  const firstByBody = new Map<string, number>();
  choices.forEach((c, index) => {
    const body = c.body.trim();
    if (body === '') return;
    const first = firstByBody.get(body);
    if (first === undefined) {
      firstByBody.set(body, index);
    } else {
      error(
        'duplicate_choice',
        { field: 'choiceBody', index },
        `選択肢 ${index + 1} の本文が選択肢 ${first + 1} と同じです。`,
      );
    }
  });

  // 保存 RPC の duplicate_choice_id と同じ条件（null は新規なので対象外）
  const ids = choices.map((c) => c.id).filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length) {
    error('duplicate_choice_id', { field: 'choices' }, '同じ ID の選択肢が複数あります。');
  }

  // 5.5 紐づけ
  if (input.keywordIds.length === 0) {
    error('no_keyword', { field: 'keywords' }, 'キーワードを1つ以上紐づけてください。');
  }
  const foreign = input.keywordIds.filter((id) => !context.subjectKeywordIds.has(id));
  if (foreign.length > 0) {
    error('foreign_keyword', { field: 'keywords' }, 'この科目に属さないキーワードが紐づけられています。');
  }

  // 5.6 原則の選択肢数（2個未満は too_few_choices で報告済み）
  const expected = EXPECTED_CHOICE_COUNT[input.kind];
  if (choices.length >= 2 && choices.length < expected) {
    warning(
      'choice_count_below',
      { field: 'choices' },
      `${KIND_LABEL[input.kind]}の選択肢は原則 ${expected} 個です（現在 ${choices.length} 個）。もっともらしい誤答を作れない場合だけ減らしてください。`,
    );
  }
  if (choices.length > expected) {
    error(
      'choice_count_above',
      { field: 'choices' },
      `${KIND_LABEL[input.kind]}の選択肢は ${expected} 個以下にしてください（現在 ${choices.length} 個）。`,
    );
  }

  // 5.7 解説にない略語
  const explained = new Set(
    [input.explanation, ...choices.map((c) => c.explanation)].flatMap(abbreviations),
  );
  const checkAbbreviations = (text: string, target: ValidationTarget, label: string) => {
    const missing = abbreviations(text).filter((a) => !explained.has(a));
    if (missing.length > 0) {
      warning(
        'abbreviation_unexplained',
        target,
        `${label}の略語 ${missing.join('、')} のフルネームを解説に書いてください。`,
      );
    }
  };
  checkAbbreviations(input.stem, { field: 'stem' }, '問題文');
  choices.forEach((c, index) =>
    checkAbbreviations(c.body, { field: 'choiceBody', index }, `選択肢 ${index + 1}`),
  );

  // 5.11 誤答の解説の空欄
  choices.forEach((c, index) => {
    if (!c.isCorrect && isBlank(c.explanation)) {
      warning(
        'wrong_choice_unexplained',
        { field: 'choiceExplanation', index },
        `選択肢 ${index + 1} は誤答です。解説を書いてください。`,
      );
    }
  });

  return issues;
}

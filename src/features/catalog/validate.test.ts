import { describe, expect, it } from 'vitest';
import type { ChoiceInput, QuestionInput, QuestionKind } from './types';
import { EXPECTED_CHOICE_COUNT, validateQuestion, type ValidationCode } from './validate';

const ctx = { subjectKeywordIds: new Set(['k1', 'k2']) };

function choice(i: number, isCorrect = false): ChoiceInput {
  return { id: null, body: `選択肢${i}`, explanation: `選択肢${i}の解説`, isCorrect };
}

function makeInput(kind: QuestionKind = 'feature', count = EXPECTED_CHOICE_COUNT[kind]): QuestionInput {
  return {
    id: null,
    subjectId: 's1',
    kind,
    stem: '次のうち正しいものはどれか',
    explanation: '全体の解説',
    keywordIds: ['k1'],
    choices: Array.from({ length: count }, (_, i) => choice(i + 1, i === 0)),
  };
}

const codes = (input: QuestionInput) => validateQuestion(input, ctx).map((i) => i.code);
const find = (input: QuestionInput, code: ValidationCode) =>
  validateQuestion(input, ctx).filter((i) => i.code === code);

describe('validateQuestion', () => {
  it('原則どおりの問題では何も返さない（両種別）', () => {
    expect(validateQuestion(makeInput('feature'), ctx)).toEqual([]);
    expect(validateQuestion(makeInput('keyword'), ctx)).toEqual([]);
  });

  it('正解が0個・2個ならエラー（correct_count）', () => {
    const none = makeInput();
    none.choices[0]!.isCorrect = false;
    const two = makeInput();
    two.choices[1]!.isCorrect = true;
    for (const input of [none, two]) {
      const issues = find(input, 'correct_count');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe('error');
      expect(issues[0]!.target).toEqual({ field: 'choices' });
      expect(issues[0]!.message).toMatch(/正解/);
    }
  });

  it('空白のみの各欄をエラーで、欄と選択肢の位置付きで返す（required）', () => {
    const input = makeInput();
    input.stem = '  ';
    input.explanation = '';
    input.choices[1]!.body = '\n';
    input.choices[2]!.explanation = ' ';
    const issues = find(input, 'required');
    expect(issues.map((i) => i.target)).toEqual([
      { field: 'stem' },
      { field: 'explanation' },
      { field: 'choiceBody', index: 1 },
      { field: 'choiceExplanation', index: 2 },
    ]);
    expect(issues.every((i) => i.severity === 'error' && i.message.length > 0)).toBe(true);
  });

  it('選択肢が2個未満ならエラー（too_few_choices）、2個なら発生しない', () => {
    expect(find(makeInput('feature', 1), 'too_few_choices')).toMatchObject([
      { severity: 'error', target: { field: 'choices' } },
    ]);
    expect(find(makeInput('feature', 0), 'too_few_choices')).toHaveLength(1);
    expect(find(makeInput('feature', 2), 'too_few_choices')).toHaveLength(0);
  });

  it('前後空白を除いて同じ本文の選択肢はエラー（duplicate_choice）、後の方を指す', () => {
    const input = makeInput();
    input.choices[3]!.body = ' 選択肢1 ';
    expect(find(input, 'duplicate_choice')).toMatchObject([
      { severity: 'error', target: { field: 'choiceBody', index: 3 } },
    ]);
    // 空欄同士は required で報告し、重複としては扱わない
    const blanks = makeInput();
    blanks.choices[1]!.body = '';
    blanks.choices[2]!.body = ' ';
    expect(find(blanks, 'duplicate_choice')).toHaveLength(0);
  });

  it('同じ選択肢 ID が複数あればエラー（duplicate_choice_id）、null は対象外', () => {
    const input = makeInput();
    input.choices[0]!.id = 'c1';
    input.choices[2]!.id = 'c1';
    expect(find(input, 'duplicate_choice_id')).toMatchObject([
      { severity: 'error', target: { field: 'choices' } },
    ]);
    expect(find(makeInput(), 'duplicate_choice_id')).toHaveLength(0);
  });

  it('紐づけ0件はエラー（no_keyword）', () => {
    const input = makeInput();
    input.keywordIds = [];
    expect(find(input, 'no_keyword')).toMatchObject([{ severity: 'error', target: { field: 'keywords' } }]);
  });

  it('科目にないキーワードはエラー（foreign_keyword）', () => {
    const input = makeInput();
    input.keywordIds = ['k1', 'x9'];
    const issues = find(input, 'foreign_keyword');
    expect(issues).toMatchObject([{ severity: 'error', target: { field: 'keywords' } }]);
    expect(find(makeInput(), 'foreign_keyword')).toHaveLength(0);
  });

  it('キーワード問題の選択肢数の境界: 5個は警告、6個は無し、7個はエラー', () => {
    expect(find(makeInput('keyword', 5), 'choice_count_below')).toMatchObject([
      { severity: 'warning', target: { field: 'choices' } },
    ]);
    expect(codes(makeInput('keyword', 6))).toEqual([]);
    expect(find(makeInput('keyword', 7), 'choice_count_above')).toMatchObject([
      { severity: 'error', target: { field: 'choices' } },
    ]);
    expect(codes(makeInput('keyword', 7))).not.toContain('choice_count_below');
  });

  it('特徴問題の選択肢数の境界: 3個は警告、4個は無し、5個はエラー', () => {
    expect(find(makeInput('feature', 3), 'choice_count_below')).toHaveLength(1);
    expect(codes(makeInput('feature', 4))).toEqual([]);
    expect(find(makeInput('feature', 5), 'choice_count_above')).toHaveLength(1);
  });

  it('選択肢が2個未満のときは choice_count_below を出さない', () => {
    expect(codes(makeInput('feature', 1))).not.toContain('choice_count_below');
  });

  it('解説にない略語は警告（abbreviation_unexplained）、解説にあれば出ない', () => {
    const input = makeInput();
    input.stem = 'TCP と UDP の違いはどれか';
    input.choices[1]!.body = 'HTTP2 を使う';
    input.choices[2]!.explanation = 'TCP は Transmission Control Protocol';
    const issues = find(input, 'abbreviation_unexplained');
    expect(issues.map((i) => [i.target, i.severity])).toEqual([
      [{ field: 'stem' }, 'warning'],
      [{ field: 'choiceBody', index: 1 }, 'warning'],
    ]);
    expect(issues[0]!.message).toContain('UDP');
    expect(issues[0]!.message).not.toContain('TCP');
    expect(issues[1]!.message).toContain('HTTP2');

    const explained = makeInput();
    explained.stem = 'DNS の役割';
    explained.explanation = 'DNS は Domain Name System';
    expect(find(explained, 'abbreviation_unexplained')).toHaveLength(0);
  });

  it('1文字の大文字や小文字混じりの語は略語として扱わない', () => {
    const input = makeInput();
    input.stem = 'A 社の Java と iOS の比較';
    expect(find(input, 'abbreviation_unexplained')).toHaveLength(0);
  });

  it('結果は規則表の順に並ぶ', () => {
    const input = makeInput('keyword', 7);
    input.choices.forEach((c) => (c.isCorrect = false));
    input.stem = ' ';
    input.choices[2]!.body = '選択肢1';
    input.choices[3]!.id = 'c';
    input.choices[4]!.id = 'c';
    input.keywordIds = [];
    input.choices[5]!.body = 'API';
    expect(codes(input)).toEqual([
      'correct_count',
      'required',
      'duplicate_choice',
      'duplicate_choice_id',
      'no_keyword',
      'choice_count_above',
      'abbreviation_unexplained',
    ]);
  });

  it('入力を変更しない', () => {
    const input = makeInput('keyword', 7);
    input.stem = ' TCP ';
    input.keywordIds = ['x9'];
    const snapshot = structuredClone(input);
    const set = new Set(['k1']);
    validateQuestion(input, { subjectKeywordIds: set });
    expect(input).toEqual(snapshot);
    expect([...set]).toEqual(['k1']);
  });
});

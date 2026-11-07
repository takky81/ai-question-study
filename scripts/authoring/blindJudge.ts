import type { AuthoredQuestion } from './importModel.ts';

export type CueKind = 'surface' | 'semantic';
export type JudgeAnswer = { surface: number | null; semantic: number | null; reason: string };
export type JudgeInput = { prompt: string; order: number[] }; // order[表示位置] = 元の選択肢の位置

// 入力トークンを抑えるため短く保つ（13.4、13.9）。knowledge は知識で解けた答えの逃がし先で、interpret では数えない
export const JUDGE_SYSTEM_PROMPT = [
  'あなたは分野の知識が全くない受験者を演じる。専門用語の意味は知らないものとする。',
  'knowledge: あなた自身の専門知識で正解と分かる選択肢番号（分からなければ null）。推測の手がかりとしては数えない。',
  'surface: 知識を使わず、見た目の手がかり（問題文と同じ語や字が選択肢に含まれる、長さ、形の違い、断定語）だけで正解と絞れる番号。',
  'semantic: 知識を使わず、選択肢の語を日常語として読んだ意味（漢字やカタカナの字面）だけで問題文に合うのが1つしかない番号（例: 絵や音楽の権利→著作権）。専門用語の定義を知っていて分かる場合は semantic ではなく knowledge にする。',
  '絞れなければ null。',
  '出力は1行の JSON のみ: {"knowledge":番号|null,"surface":番号|null,"semantic":番号|null,"reason":"30字以内"}',
].join('\n');

export function buildJudgeInput(q: AuthoredQuestion, random: () => number): JudgeInput {
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const lines = order.map((orig, pos) => `${pos + 1}. ${q.choices[orig]!.body}`);
  return { prompt: `${q.stem}\n${lines.join('\n')}`, order };
}

const isChoiceNumber = (v: unknown, n: number): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= n);

// 前後の余分な文字やコードフェンスを許し、最初の { から最後の } までを JSON として読む
export function parseJudgeAnswer(text: string, choiceCount: number): JudgeAnswer | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { surface, semantic, reason } = v as Record<string, unknown>;
  if (!('surface' in v) || !('semantic' in v)) return null;
  if (!isChoiceNumber(surface, choiceCount) || !isChoiceNumber(semantic, choiceCount)) return null;
  if (typeof reason !== 'string') return null;
  return { surface, semantic, reason };
}

export function interpret(
  answer: JudgeAnswer,
  input: JudgeInput,
  q: AuthoredQuestion,
): { guessable: boolean; cues: CueKind[]; reason: string } {
  const pointsAtCorrect = (n: number | null) => n !== null && q.choices[input.order[n - 1] ?? -1]?.isCorrect === true;
  const cues: CueKind[] = [];
  if (pointsAtCorrect(answer.surface)) cues.push('surface');
  if (pointsAtCorrect(answer.semantic)) cues.push('semantic');
  return { guessable: cues.length > 0, cues, reason: answer.reason };
}

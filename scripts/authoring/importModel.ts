// 取込用 JSON（ai-question-study/import, version 1）から、点検と判定の対象になる問題（作成・修正）を取り出す。
// Node の型除去だけで動かすため、src/ の型は読み込まず、必要な最小の形だけをここで定義する。

export type AuthoredChoice = { body: string; explanation: string; isCorrect: boolean };
export type AuthoredQuestion = {
  ref: string; // 作成は tempKey、修正は id
  kind: 'keyword' | 'feature';
  stem: string;
  explanation: string;
  choices: AuthoredChoice[];
};

export type ExtractResult = { ok: true; questions: AuthoredQuestion[] } | { ok: false; error: string };

const IMPORT_FORMAT = 'ai-question-study/import';
const IMPORT_VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toChoice(v: unknown, where: string): AuthoredChoice | string {
  if (!isRecord(v)) return `${where} がオブジェクトではない`;
  const { body, explanation, isCorrect } = v;
  if (typeof body !== 'string' || typeof explanation !== 'string' || typeof isCorrect !== 'boolean') {
    return `${where} の body・explanation・isCorrect の形が正しくない`;
  }
  return { body, explanation, isCorrect };
}

function toQuestion(v: unknown, ref: string | undefined, where: string): AuthoredQuestion | string {
  if (!isRecord(v)) return `${where} がオブジェクトではない`;
  if (ref === undefined) return `${where} に id がない`;
  const { kind, stem, explanation, choices } = v;
  if (kind !== 'keyword' && kind !== 'feature') return `${where}.kind が keyword でも feature でもない`;
  if (typeof stem !== 'string' || typeof explanation !== 'string')
    return `${where} の stem・explanation が文字列ではない`;
  if (!Array.isArray(choices)) return `${where}.choices が配列ではない`;
  const out: AuthoredChoice[] = [];
  for (const [i, c] of choices.entries()) {
    const choice = toChoice(c, `${where}.choices[${i}]`);
    if (typeof choice === 'string') return choice;
    out.push(choice);
  }
  return { ref, kind, stem, explanation, choices: out };
}

export function extractQuestions(file: unknown): ExtractResult {
  if (!isRecord(file)) return { ok: false, error: 'ファイルがオブジェクトではない' };
  if (file.format !== IMPORT_FORMAT) return { ok: false, error: `format が ${IMPORT_FORMAT} ではない` };
  if (file.version !== IMPORT_VERSION)
    return { ok: false, error: `version ${String(file.version)} には対応していない` };
  const questions = file.questions ?? {};
  if (!isRecord(questions)) return { ok: false, error: 'questions がオブジェクトではない' };
  const create = questions.create ?? [];
  const update = questions.update ?? [];
  if (!Array.isArray(create)) return { ok: false, error: 'questions.create が配列ではない' };
  if (!Array.isArray(update)) return { ok: false, error: 'questions.update が配列ではない' };

  const out: AuthoredQuestion[] = [];
  for (const [i, q] of create.entries()) {
    const tempKey = isRecord(q) && typeof q.tempKey === 'string' ? q.tempKey : `create#${i}`;
    const r = toQuestion(q, tempKey, `questions.create[${i}]`);
    if (typeof r === 'string') return { ok: false, error: r };
    out.push(r);
  }
  for (const [i, q] of update.entries()) {
    const id = isRecord(q) && typeof q.id === 'string' ? q.id : undefined;
    const r = toQuestion(q, id, `questions.update[${i}]`);
    if (typeof r === 'string') return { ok: false, error: r };
    out.push(r);
  }
  return { ok: true, questions: out };
}

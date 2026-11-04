// 適用ペイロードの生成（7.1、8.3）。純粋関数。apply_exchange_import の入力（camelCase）に一致させる。
import type { QuestionInput } from '@/features/catalog/types';
import type { ImportDiff } from './diff';
import type { ImportChoice, ImportFileV1, ImportQuestionBody, KeywordRef } from './format';
import { tempKeywordId, type ImportSnapshot } from './importValidate';

export type ApplyPayload = {
  subjectId: string;
  expected: { keywords: { id: string; updatedAt: string }[]; questions: { id: string; updatedAt: string }[] };
  keywordAdds: { tempKey: string; parentId: string | null; parentTempKey: string | null; name: string }[];
  keywordRenames: { id: string; name: string }[];
  keywordMoves: { id: string; parentId: string | null; parentTempKey: string | null }[];
  questionUpdates: { input: QuestionInput }[];
  questionCreates: { tempKey: string; input: QuestionInput }[]; // tempKey なしの問題は 'q<index>' を割り当てる
  questionDisables: { id: string; reason: string | null }[];
  modifiedQuestionIds: string[];
};

const parentFields = (ref: KeywordRef | null) =>
  ref === null
    ? { parentId: null, parentTempKey: null }
    : 'id' in ref
      ? { parentId: ref.id, parentTempKey: null }
      : { parentId: null, parentTempKey: ref.tempKey };

const refId = (ref: KeywordRef) => ('id' in ref ? ref.id : tempKeywordId(ref.tempKey));

function toInput(subjectId: string, id: string | null, body: ImportQuestionBody | ImportFileV1['questions']['create'][number]): QuestionInput {
  return {
    id,
    subjectId,
    kind: body.kind,
    stem: body.stem,
    explanation: body.explanation,
    keywordIds: body.keywords.map(refId),
    choices: body.choices.map((c: Omit<ImportChoice, 'id'> & { id?: string }) => ({
      id: c.id ?? null,
      body: c.body,
      explanation: c.explanation,
      isCorrect: c.isCorrect,
    })),
  };
}

export function buildApplyPayload(file: ImportFileV1, snapshot: ImportSnapshot, diff: ImportDiff): ApplyPayload {
  const subjectId = file.subjectId;
  const keywordAt = new Map(snapshot.keywords.map((k) => [k.id, k.updatedAt]));

  // ---- キーワード追加: 親（一時キー）を先に出す深さ優先の順。循環は検証で拒否済み ----
  const addByKey = new Map(file.keywords.add.map((a) => [a.tempKey, a]));
  const keywordAdds: ApplyPayload['keywordAdds'] = [];
  const visited = new Set<string>();
  const visit = (tempKey: string) => {
    const a = addByKey.get(tempKey);
    if (!a || visited.has(tempKey)) return;
    visited.add(tempKey);
    if (a.parent !== null && 'tempKey' in a.parent) visit(a.parent.tempKey);
    keywordAdds.push({ tempKey: a.tempKey, ...parentFields(a.parent), name: a.name.trim() });
  };
  for (const a of file.keywords.add) visit(a.tempKey);

  // ---- 改名・移動: 差分で変化ありのものだけ。移動は差分の順（途中で循環しない順）を保つ ----
  const renameById = new Map(file.keywords.rename.map((r) => [r.id, r]));
  const moveById = new Map(file.keywords.move.map((m) => [m.id, m]));
  const keywordRenames: ApplyPayload['keywordRenames'] = [];
  const keywordMoves: ApplyPayload['keywordMoves'] = [];
  for (const change of diff.keywords) {
    if (change.type === 'renamed') {
      keywordRenames.push({ id: change.id, name: (renameById.get(change.id) as { name: string }).name.trim() });
    } else if (change.type === 'moved') {
      keywordMoves.push({ id: change.id, ...parentFields((moveById.get(change.id) as { parent: KeywordRef | null }).parent) });
    }
  }

  // ---- 問題 ----
  const questionUpdates = diff.updated.map((u) => ({ input: toInput(subjectId, u.id, u.after) }));
  const questionCreates = diff.created.map((c) => ({
    tempKey: c.tempKey ?? `q${c.index}`,
    input: toInput(subjectId, null, c.body),
  }));
  const questionDisables = diff.disabled.filter((d) => !d.alreadyDisabled).map((d) => ({ id: d.id, reason: d.reason }));

  // ---- expected（7.1）: 触れる既存の行とスナップショットの updatedAt ----
  const expectedKeywords = new Map<string, string>();
  const expectKeyword = (id: string | null) => {
    const at = id === null ? undefined : keywordAt.get(id);
    if (id !== null && at !== undefined && !expectedKeywords.has(id)) expectedKeywords.set(id, at);
  };
  for (const r of keywordRenames) expectKeyword(r.id);
  for (const m of keywordMoves) {
    expectKeyword(m.id);
    expectKeyword(m.parentId);
  }
  for (const a of keywordAdds) expectKeyword(a.parentId);
  for (const q of [...questionUpdates, ...questionCreates]) q.input.keywordIds.forEach(expectKeyword);

  const expectedQuestions = [...questionUpdates.map((q) => q.input.id as string), ...questionDisables.map((d) => d.id)].flatMap(
    (id) => {
      const q = snapshot.questions.get(id);
      return q ? [{ id, updatedAt: q.updatedAt }] : [];
    },
  );

  return {
    subjectId,
    expected: {
      keywords: [...expectedKeywords].map(([id, updatedAt]) => ({ id, updatedAt })),
      questions: expectedQuestions,
    },
    keywordAdds,
    keywordRenames,
    keywordMoves,
    questionUpdates,
    questionCreates,
    questionDisables,
    modifiedQuestionIds: diff.updated.map((u) => u.id),
  };
}

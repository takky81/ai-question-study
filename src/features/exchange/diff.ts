// 取込ファイルと現在のデータの差分、修正の判定（3.6、5.1〜5.8、8.2、8.3）。純粋関数。
import { keywordPath, type KeywordNode } from '@/lib/keywordTree';
import type { ExportFlag, ImportChoice, ImportFileV1, ImportQuestionBody, KeywordRef } from './format';
import { tempKeywordId, type ImportIssue, type ImportSnapshot, type SnapshotQuestion } from './importValidate';

type SnapshotChoice = SnapshotQuestion['choices'][number];

export type ChoiceChange =
  | { type: 'added'; after: ImportChoice; index: number }
  | { type: 'removed'; before: SnapshotChoice }
  | { type: 'changed'; id: string; fields: ('body' | 'explanation' | 'isCorrect')[]; before: SnapshotChoice; after: ImportChoice }
  | { type: 'moved'; id: string; fromIndex: number; toIndex: number };

export type QuestionChange = {
  id: string;
  fields: ('kind' | 'stem' | 'explanation' | 'keywords')[];
  choices: ChoiceChange[];
  before: SnapshotQuestion;
  after: ImportQuestionBody;
  flagsToResolve: ExportFlag[];
  updatedSinceExport: boolean;
};

export type KeywordChange =
  | { type: 'added'; tempKey: string; afterPath: string[] }
  | { type: 'renamed' | 'moved'; id: string; beforePath: string[]; afterPath: string[] };

export type ImportDiff = {
  /** 追加（ファイル順）→ 改名（ファイル順）→ 移動（移動後の深さが浅い順。配列順に1件ずつ適用しても途中で循環しない）。 */
  keywords: KeywordChange[];
  updated: QuestionChange[];
  unchanged: string[]; // 内容が同一の修正対象の問題 ID
  created: { index: number; tempKey?: string; body: ImportQuestionBody; keywordPaths: string[][] }[];
  disabled: { id: string; stem: string; reason: string | null; alreadyDisabled: boolean }[];
  counts: {
    keywordsAdded: number;
    keywordsRenamed: number;
    keywordsMoved: number;
    questionsUpdated: number;
    questionsCreated: number;
    questionsDisabled: number;
  };
  warnings: ImportIssue[]; // updated_since_export
};

const same = (a: string, b: string) => a.trim() === b.trim();
const refId = (ref: KeywordRef) => ('id' in ref ? ref.id : tempKeywordId(ref.tempKey));

function sameKeywordSet(before: readonly string[], after: readonly KeywordRef[]): boolean {
  const a = new Set(before);
  const b = new Set(after.map(refId));
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function choiceFields(before: SnapshotChoice, after: ImportChoice): ('body' | 'explanation' | 'isCorrect')[] {
  const fields: ('body' | 'explanation' | 'isCorrect')[] = [];
  if (!same(before.body, after.body)) fields.push('body');
  if (!same(before.explanation, after.explanation)) fields.push('explanation');
  if (before.isCorrect !== after.isCorrect) fields.push('isCorrect');
  return fields;
}

function questionFields(before: SnapshotQuestion, after: ImportQuestionBody): QuestionChange['fields'] {
  const fields: QuestionChange['fields'] = [];
  if (before.kind !== after.kind) fields.push('kind');
  if (!same(before.stem, after.stem)) fields.push('stem');
  if (!same(before.explanation, after.explanation)) fields.push('explanation');
  if (!sameKeywordSet(before.keywordIds, after.keywords)) fields.push('keywords');
  return fields;
}

/** 修正の判定（8.2）: 問題文・解説・種別・紐づけの集合・選択肢の列のいずれかが前後空白を除いて異なれば真。 */
export function isQuestionModified(before: SnapshotQuestion, after: ImportQuestionBody): boolean {
  if (questionFields(before, after).length > 0) return true;
  if (before.choices.length !== after.choices.length) return true;
  return before.choices.some((b, i) => {
    const a = after.choices[i] as ImportChoice;
    return a.id !== b.id || choiceFields(b, a).length > 0;
  });
}

function choiceChanges(before: SnapshotChoice[], after: ImportChoice[]): ChoiceChange[] {
  const out: ChoiceChange[] = [];
  const beforeIndex = new Map(before.map((c, i) => [c.id, i]));
  const afterIds = new Set(after.flatMap((c) => (c.id === undefined ? [] : [c.id])));
  after.forEach((a, index) => {
    const b = a.id === undefined ? undefined : before[beforeIndex.get(a.id) ?? -1];
    if (!b) {
      out.push({ type: 'added', after: a, index });
      return;
    }
    const fields = choiceFields(b, a);
    if (fields.length > 0) out.push({ type: 'changed', id: b.id, fields, before: b, after: a });
  });
  for (const b of before) if (!afterIds.has(b.id)) out.push({ type: 'removed', before: b });

  // 並べ替え: 残った選択肢どうしの相対順が変わったものだけ（追加・削除による位置のずれは含めない）
  const keptBefore = before.filter((c) => afterIds.has(c.id)).map((c) => c.id);
  const keptAfter = after.flatMap((c) => (c.id !== undefined && beforeIndex.has(c.id) ? [c.id] : []));
  keptAfter.forEach((id, rank) => {
    if (keptBefore[rank] === id) return;
    const toIndex = after.findIndex((c) => c.id === id);
    out.push({ type: 'moved', id, fromIndex: beforeIndex.get(id) as number, toIndex });
  });
  return out;
}

const isAfter = (updatedAt: string, exportedAt: string | null) =>
  exportedAt !== null && Date.parse(updatedAt) > Date.parse(exportedAt);

const STALE_MESSAGE = (label: string) => `${label}は出力後に更新されています。`;

export function computeImportDiff(file: ImportFileV1, snapshot: ImportSnapshot): ImportDiff {
  const { add, rename, move } = file.keywords;
  const { update, create, disable } = file.questions;
  const exportedAt = file.basedOnExportedAt;
  const warnings: ImportIssue[] = [];
  const warn = (path: string, label: string) =>
    warnings.push({ severity: 'warning', path, code: 'updated_since_export', message: STALE_MESSAGE(label) });

  // ---- キーワード: 変更前の木と、add → rename → move を適用した変更後の木 ----
  const beforeTree: KeywordNode[] = snapshot.keywords;
  const existing = new Map(snapshot.keywords.map((k) => [k.id, k]));
  const afterTree = new Map<string, KeywordNode>(snapshot.keywords.map((k) => [k.id, { ...k }]));
  for (const a of add) {
    const id = tempKeywordId(a.tempKey);
    if (!afterTree.has(id)) afterTree.set(id, { id, parentId: a.parent === null ? null : refId(a.parent), name: a.name, sortOrder: 0 });
  }
  const renames = rename.flatMap((r, i) => {
    const node = afterTree.get(r.id);
    if (!existing.has(r.id) || !node || same(node.name, r.name)) return [];
    node.name = r.name.trim();
    return [{ id: r.id, path: `keywords.rename[${i}]` }];
  });
  const moves = move.flatMap((m, i) => {
    const node = afterTree.get(m.id);
    const parentId = m.parent === null ? null : refId(m.parent);
    if (!existing.has(m.id) || !node || node.parentId === parentId) return [];
    node.parentId = parentId;
    return [{ id: m.id, path: `keywords.move[${i}]` }];
  });
  const afterNodes = [...afterTree.values()];
  const names = (nodes: readonly KeywordNode[], id: string) => keywordPath(nodes, id).map((n) => n.name);
  const depth = (id: string) => keywordPath(afterNodes, id).length;
  const sortedMoves = moves
    .map((m, order) => ({ ...m, order, depth: depth(m.id) }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order);

  const keywords: KeywordChange[] = [
    ...add.map((a) => ({ type: 'added' as const, tempKey: a.tempKey, afterPath: names(afterNodes, tempKeywordId(a.tempKey)) })),
    ...renames.map(({ id }) => ({ type: 'renamed' as const, id, beforePath: names(beforeTree, id), afterPath: names(afterNodes, id) })),
    ...sortedMoves.map(({ id }) => ({ type: 'moved' as const, id, beforePath: names(beforeTree, id), afterPath: names(afterNodes, id) })),
  ];
  for (const { id, path } of [...renames, ...moves]) {
    const k = existing.get(id);
    if (k && isAfter(k.updatedAt, exportedAt)) warn(path, `キーワード「${k.name}」`);
  }

  // ---- 問題 ----
  const updated: QuestionChange[] = [];
  const unchanged: string[] = [];
  update.forEach((u, i) => {
    const before = snapshot.questions.get(u.id);
    if (!before) return;
    if (!isQuestionModified(before, u)) {
      unchanged.push(u.id);
      return;
    }
    const { id: _id, ...after } = u;
    const updatedSinceExport = isAfter(before.updatedAt, exportedAt);
    if (updatedSinceExport) warn(`questions.update[${i}]`, `問題 ${u.id}`);
    updated.push({
      id: u.id,
      fields: questionFields(before, u),
      choices: choiceChanges(before.choices, u.choices),
      before,
      after,
      flagsToResolve: snapshot.openFlags.get(u.id) ?? [],
      updatedSinceExport,
    });
  });

  const created: ImportDiff['created'] = create.map((c, index) => ({
    index,
    ...(c.tempKey !== undefined ? { tempKey: c.tempKey } : {}),
    body: c,
    keywordPaths: c.keywords.map((ref) => names(afterNodes, refId(ref))),
  }));

  const disabled: ImportDiff['disabled'] = disable.flatMap((d, i) => {
    const q = snapshot.questions.get(d.id);
    if (!q) return [];
    const alreadyDisabled = q.status === 'disabled';
    if (!alreadyDisabled && isAfter(q.updatedAt, exportedAt)) warn(`questions.disable[${i}]`, `問題 ${d.id}`);
    return [{ id: d.id, stem: q.stem, reason: d.reason, alreadyDisabled }];
  });

  return {
    keywords,
    updated,
    unchanged,
    created,
    disabled,
    counts: {
      keywordsAdded: add.length,
      keywordsRenamed: renames.length,
      keywordsMoved: moves.length,
      questionsUpdated: updated.length,
      questionsCreated: created.length,
      questionsDisabled: disabled.filter((d) => !d.alreadyDisabled).length,
    },
    warnings,
  };
}

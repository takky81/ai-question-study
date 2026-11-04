// 取込ファイルの参照・構造・作問ルールの検証（4.4〜4.10、4.12、4.13）。純粋関数。
import type { Keyword, QuestionInput, QuestionKind } from '@/features/catalog/types';
import { validateQuestion, type ValidationCode, type ValidationTarget } from '@/features/catalog/validate';
import { keywordSubtreeIds, type KeywordNode } from '@/lib/keywordTree';
import type { ExportFlag, ImportChoice, ImportFileV1, KeywordRef } from './format';

export type ImportSnapshot = {
  subject: { id: string; name: string; deleted: boolean } | null;
  keywords: (Keyword & { updatedAt: string })[]; // 科目の全件（updatedAt は 5.8、7.1）
  foreignKeywordIds: ReadonlySet<string>; // 参照されたが科目外・不存在の ID
  questions: Map<string, SnapshotQuestion>; // 参照された問題（削除済みを含む）
  openFlags: Map<string, ExportFlag[]>;
};

export type SnapshotQuestion = {
  id: string;
  subjectId: string;
  kind: QuestionKind;
  stem: string;
  explanation: string;
  keywordIds: string[];
  choices: { id: string; body: string; explanation: string; isCorrect: boolean }[]; // 現在の有効な選択肢
  status: 'active' | 'disabled' | 'deleted';
  updatedAt: string;
};

export type ImportIssueCode =
  | 'subject_mismatch'
  | 'keyword_not_found'
  | 'question_not_found'
  | 'question_deleted'
  | 'choice_not_in_question'
  | 'keyword_cycle'
  | 'duplicate_sibling'
  | 'temp_key_duplicate'
  | 'temp_key_undefined'
  | 'duplicate_target'
  | 'edit_disabled'
  | 'updated_since_export';

export type ImportIssue = {
  severity: 'error' | 'warning';
  path: string;
  code: ImportIssueCode | ValidationCode;
  message: string;
};

/** 一時キーのキーワードを仮の ID で表す（plan.ts と同じ表記）。 */
export const tempKeywordId = (tempKey: string) => `tmp:${tempKey}`;

const SECTIONS = [
  'subjectId',
  'keywords.add',
  'keywords.rename',
  'keywords.move',
  'questions.update',
  'questions.create',
  'questions.disable',
] as const;
type Section = (typeof SECTIONS)[number];

type Ordered = ImportIssue & { section: number; index: number; seq: number };

function targetPath(base: string, target: ValidationTarget): string {
  switch (target.field) {
    case 'choiceBody':
      return `${base}.choices[${target.index}].body`;
    case 'choiceExplanation':
      return `${base}.choices[${target.index}].explanation`;
    default:
      return `${base}.${target.field}`;
  }
}

export function validateImport(file: ImportFileV1, snapshot: ImportSnapshot): ImportIssue[] {
  const out: Ordered[] = [];
  const push = (
    section: Section,
    index: number,
    severity: ImportIssue['severity'],
    path: string,
    code: ImportIssue['code'],
    message: string,
  ) => out.push({ severity, path, code, message, section: SECTIONS.indexOf(section), index, seq: out.length });
  const err = (section: Section, index: number, path: string, code: ImportIssue['code'], message: string) =>
    push(section, index, 'error', path, code, message);

  const { add, rename, move } = file.keywords;
  const { update, create, disable } = file.questions;

  // ---- 科目 ----
  const subject = snapshot.subject;
  if (subject === null || subject.id !== file.subjectId) {
    err('subjectId', 0, 'subjectId', 'subject_mismatch', `科目が見つかりません（${file.subjectId}）。`);
  } else if (subject.deleted) {
    err('subjectId', 0, 'subjectId', 'subject_mismatch', `科目「${subject.name}」は削除されています。`);
  }

  const existing = new Map(snapshot.keywords.map((k) => [k.id, k]));
  const keywordMissingMessage = (id: string) =>
    snapshot.foreignKeywordIds.has(id) && !existing.has(id)
      ? `キーワード ${id} は別の科目のもの、または存在しません。`
      : `キーワード ${id} はこの科目にありません。`;

  // ---- 一時キー（キーワード）----
  const addTempKeys = new Set<string>();
  add.forEach((a, i) => {
    if (addTempKeys.has(a.tempKey)) {
      err('keywords.add', i, `keywords.add[${i}].tempKey`, 'temp_key_duplicate', `一時キー ${a.tempKey} が重複しています。`);
    }
    addTempKeys.add(a.tempKey);
  });

  /** 参照を検査し、解決できれば仮想の木での ID、できなければ undefined を返す。 */
  const resolveRef = (ref: KeywordRef, section: Section, index: number, path: string): string | undefined => {
    if ('id' in ref) {
      if (existing.has(ref.id)) return ref.id;
      err(section, index, `${path}.id`, 'keyword_not_found', keywordMissingMessage(ref.id));
      return undefined;
    }
    if (addTempKeys.has(ref.tempKey)) return tempKeywordId(ref.tempKey);
    err(section, index, `${path}.tempKey`, 'temp_key_undefined', `一時キー ${ref.tempKey} はキーワードの追加で定義されていません。`);
    return undefined;
  };

  // ---- 仮想の木（add → rename → move）----
  type VNode = KeywordNode & { touched?: { section: Section; index: number; path: string } };
  const tree = new Map<string, VNode>(snapshot.keywords.map((k) => [k.id, { ...k }]));
  const touch = (node: VNode, section: Section, index: number, path: string) => {
    node.touched ??= { section, index, path };
  };
  const addParents: { index: number; id: string }[] = [];
  add.forEach((a, i) => {
    const parentId = a.parent === null ? null : resolveRef(a.parent, 'keywords.add', i, `keywords.add[${i}].parent`);
    const id = tempKeywordId(a.tempKey);
    if (tree.has(id)) return; // 重複した一時キーは最初のものだけ木に載せる
    const node: VNode = { id, parentId: parentId ?? null, name: a.name, sortOrder: 0 };
    touch(node, 'keywords.add', i, `keywords.add[${i}].name`);
    tree.set(id, node);
    if (parentId !== undefined && parentId !== null) addParents.push({ index: i, id });
  });

  const inCycle = (list: readonly KeywordNode[], id: string) => {
    const parentId = list.find((n) => n.id === id)?.parentId;
    return parentId != null && keywordSubtreeIds(list, id).includes(parentId);
  };
  const beforeMoves = [...tree.values()].map((n) => ({ ...n }));
  for (const { index, id } of addParents) {
    if (inCycle(beforeMoves, id)) {
      err('keywords.add', index, `keywords.add[${index}].parent`, 'keyword_cycle', '親の指定が循環しています（追加するキーワードどうしが互いを親にしています）。');
    }
  }

  const renamed = new Set<string>();
  rename.forEach((r, i) => {
    const node = existing.has(r.id) ? tree.get(r.id) : undefined;
    if (!node) {
      err('keywords.rename', i, `keywords.rename[${i}].id`, 'keyword_not_found', keywordMissingMessage(r.id));
      return;
    }
    if (renamed.has(r.id)) {
      err('keywords.rename', i, `keywords.rename[${i}].id`, 'duplicate_target', `キーワード「${node.name}」の改名が複数あります。`);
      return;
    }
    renamed.add(r.id);
    node.name = r.name;
    touch(node, 'keywords.rename', i, `keywords.rename[${i}].name`);
  });

  const moved = new Set<string>();
  const appliedMoves: { index: number; id: string }[] = [];
  move.forEach((m, i) => {
    const node = existing.has(m.id) ? tree.get(m.id) : undefined;
    if (!node) {
      err('keywords.move', i, `keywords.move[${i}].id`, 'keyword_not_found', keywordMissingMessage(m.id));
    } else if (moved.has(m.id)) {
      err('keywords.move', i, `keywords.move[${i}].id`, 'duplicate_target', `キーワード「${node.name}」の移動が複数あります。`);
      return;
    }
    const parentId = m.parent === null ? null : resolveRef(m.parent, 'keywords.move', i, `keywords.move[${i}].parent`);
    if (!node || parentId === undefined) return;
    moved.add(m.id);
    node.parentId = parentId;
    touch(node, 'keywords.move', i, `keywords.move[${i}].parent`);
    appliedMoves.push({ index: i, id: m.id });
  });

  // ---- 循環（4.6）: 追加どうしの循環は移動の前の木で、移動による循環は移動後の木で判定する ----
  for (const { index, id } of appliedMoves) {
    if (inCycle([...tree.values()], id)) {
      err('keywords.move', index, `keywords.move[${index}].parent`, 'keyword_cycle', '移動先が自分自身または配下のキーワードです。');
    }
  }

  // ---- 兄弟名の重複（4.7）----
  const nodes = [...tree.values()];
  const siblings = new Map<string, VNode[]>();
  for (const n of nodes) {
    const key = `${n.parentId ?? ''}\u0000${n.name.trim()}`;
    siblings.set(key, [...(siblings.get(key) ?? []), n]);
  }
  for (const group of siblings.values()) {
    if (group.length < 2) continue;
    for (const n of group) {
      if (!n.touched) continue;
      const { section, index, path } = n.touched;
      err(section, index, path, 'duplicate_sibling', `同じ親の下に「${n.name.trim()}」という名前のキーワードがすでにあります。`);
    }
  }

  // ---- 問題 ----
  const subjectKeywordIds = new Set<string>([...existing.keys(), ...[...addTempKeys].map(tempKeywordId)]);
  const choiceOwner = new Map<string, string>();
  for (const q of snapshot.questions.values()) for (const c of q.choices) choiceOwner.set(c.id, q.id);

  const checkQuestionRef = (id: string, section: Section, index: number, path: string): SnapshotQuestion | undefined => {
    const q = snapshot.questions.get(id);
    if (!q) {
      err(section, index, path, 'question_not_found', `問題 ${id} が見つかりません。`);
      return undefined;
    }
    if (q.subjectId !== file.subjectId) {
      err(section, index, path, 'question_not_found', `問題 ${id} は別の科目の問題です。`);
      return undefined;
    }
    if (q.status === 'deleted') {
      err(section, index, path, 'question_deleted', `問題 ${id} は削除されています。`);
      return undefined;
    }
    return q;
  };

  const checkBody = (
    section: Section,
    index: number,
    base: string,
    q: { kind: QuestionKind; stem: string; explanation: string; keywords: KeywordRef[]; choices: ImportChoice[] },
    id: string | null,
  ) => {
    let badRef = false;
    const keywordIds: string[] = [];
    q.keywords.forEach((ref, k) => {
      const resolved = resolveRef(ref, section, index, `${base}.keywords[${k}]`);
      if (resolved === undefined) badRef = true;
      keywordIds.push(resolved ?? ('id' in ref ? ref.id : tempKeywordId(ref.tempKey)));
    });
    const input: QuestionInput = {
      id,
      subjectId: file.subjectId,
      kind: q.kind,
      stem: q.stem,
      explanation: q.explanation,
      keywordIds,
      choices: q.choices.map((c) => ({ id: c.id ?? null, body: c.body, explanation: c.explanation, isCorrect: c.isCorrect })),
    };
    for (const v of validateQuestion(input, { subjectKeywordIds })) {
      if (badRef && v.code === 'foreign_keyword') continue; // 参照エラーとして報告済み
      push(section, index, v.severity, targetPath(base, v.target), v.code, v.message);
    }
  };

  const questionTargets = new Set<string>();
  update.forEach((u, i) => {
    const base = `questions.update[${i}]`;
    if (questionTargets.has(u.id)) {
      err('questions.update', i, `${base}.id`, 'duplicate_target', `問題 ${u.id} が複数の操作の対象になっています。`);
    }
    questionTargets.add(u.id);
    const q = checkQuestionRef(u.id, 'questions.update', i, `${base}.id`);
    if (q) {
      const own = new Set(q.choices.map((c) => c.id));
      u.choices.forEach((c, k) => {
        if (c.id === undefined || own.has(c.id)) return;
        const owner = choiceOwner.get(c.id);
        err(
          'questions.update',
          i,
          `${base}.choices[${k}].id`,
          'choice_not_in_question',
          owner ? `選択肢 ${c.id} は別の問題（${owner}）の選択肢です。` : `選択肢 ${c.id} はこの問題の有効な選択肢にありません。`,
        );
      });
      if (q.status === 'disabled') {
        push('questions.update', i, 'warning', base, 'edit_disabled', `問題 ${u.id} は無効です。修正しても無効のまま残ります。`);
      }
    }
    checkBody('questions.update', i, base, u, u.id);
  });

  const createTempKeys = new Set<string>();
  create.forEach((c, i) => {
    const base = `questions.create[${i}]`;
    if (c.tempKey !== undefined) {
      if (createTempKeys.has(c.tempKey)) {
        err('questions.create', i, `${base}.tempKey`, 'temp_key_duplicate', `一時キー ${c.tempKey} が重複しています。`);
      }
      createTempKeys.add(c.tempKey);
    }
    checkBody('questions.create', i, base, c, null);
  });

  disable.forEach((d, i) => {
    const path = `questions.disable[${i}].id`;
    if (questionTargets.has(d.id)) {
      err('questions.disable', i, path, 'duplicate_target', `問題 ${d.id} が複数の操作の対象になっています。`);
    }
    questionTargets.add(d.id);
    checkQuestionRef(d.id, 'questions.disable', i, path);
  });

  return out
    .sort((a, b) => a.section - b.section || a.index - b.index || a.seq - b.seq)
    .map(({ severity, path, code, message }) => ({ severity, path, code, message }));
}

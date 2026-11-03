import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD } from './helpers';

// subject-catalog の RLS と DB 制約を、所有者と別アカウントの supabase-js クライアントで直接確認する。
// 画面は使わないため、1つのプロジェクト（desktop）でだけ実行する。

const OTHER_EMAIL = 'other@example.com';
const OTHER_PASSWORD = 'other-password-local';

function loadEnv(): { url: string; key: string } {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m?.[1] !== undefined) env[m[1]] = m[2] ?? '';
    }
  } catch {
    // .env.local がなければ環境変数だけを使う
  }
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が必要です');
  return { url, key };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const { url, key } = loadEnv();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

type ChoiceInput = { id?: string | null; body: string; explanation: string; isCorrect: boolean };

function choices(correct: boolean[]): ChoiceInput[] {
  return correct.map((isCorrect, i) => ({ body: `選択肢${i + 1}`, explanation: `解説${i + 1}`, isCorrect }));
}

const RUN = `rls-${Date.now()}`;

let owner: SupabaseClient;
let other: SupabaseClient;
const createdSubjects: string[] = [];

async function createSubject(name: string): Promise<string> {
  const { data, error } = await owner.from('subjects').insert({ name: `${RUN}-${name}` }).select('id').single();
  if (error) throw error;
  createdSubjects.push(data.id);
  return data.id as string;
}

async function createKeyword(subjectId: string, name: string, parentId: string | null = null): Promise<string> {
  const { data, error } = await owner
    .from('keywords')
    .insert({ subject_id: subjectId, parent_id: parentId, name })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function saveQuestion(
  client: SupabaseClient,
  subjectId: string,
  keywordIds: string[],
  cs: ChoiceInput[],
  id: string | null = null,
) {
  return client.rpc('save_question', {
    p: { id, subjectId, kind: 'keyword', stem: '問題文', explanation: '全体の解説', keywordIds, choices: cs },
  });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  owner = await signIn(OWNER_EMAIL, OWNER_PASSWORD);
  other = await signIn(OTHER_EMAIL, OTHER_PASSWORD);
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop' || !owner) return;
  // 物理削除すると配下のキーワード・問題・選択肢・紐づけも cascade で消える
  if (createdSubjects.length > 0) {
    const { error } = await owner.from('subjects').delete().in('id', createdSubjects);
    if (error) throw error;
  }
  await owner.auth.signOut();
  await other.auth.signOut();
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'DB だけを検証するため desktop でのみ実行する');
});

test.describe('RLS: 別アカウントから所有者のデータを扱えない', () => {
  let subjectId: string;
  let keywordId: string;
  let questionId: string;

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;
    subjectId = await createSubject('rls');
    keywordId = await createKeyword(subjectId, 'K');
    const { data, error } = await saveQuestion(owner, subjectId, [keywordId], choices([true, false]));
    if (error) throw error;
    questionId = data as string;
  });

  test('別アカウントからは科目・キーワード・問題・選択肢・紐づけが見えない', async () => {
    for (const [table, column, value] of [
      ['subjects', 'id', subjectId],
      ['keywords', 'id', keywordId],
      ['questions', 'id', questionId],
      ['choices', 'question_id', questionId],
      ['question_keywords', 'question_id', questionId],
      ['servable_questions', 'id', questionId],
    ] as const) {
      const { data, error } = await other.from(table).select('*').eq(column, value);
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    const { data: subtree } = await other.rpc('keyword_subtree_ids', { p_keyword_id: keywordId });
    expect(subtree).toEqual([]);
    // 所有者からは見える
    const { data: mine } = await owner.from('questions').select('id').eq('id', questionId);
    expect(mine).toHaveLength(1);
  });

  test('別アカウントの更新・削除は反映されない', async () => {
    await other.from('subjects').update({ name: 'hacked' }).eq('id', subjectId);
    await other.from('questions').update({ stem: 'hacked' }).eq('id', questionId);
    await other.from('choices').update({ body: 'hacked' }).eq('question_id', questionId);
    await other.from('keywords').delete().eq('id', keywordId);
    await other.from('question_keywords').delete().eq('question_id', questionId);
    await other.from('choices').delete().eq('question_id', questionId);
    await other.from('questions').delete().eq('id', questionId);
    await other.from('subjects').delete().eq('id', subjectId);

    const { data: s } = await owner.from('subjects').select('name').eq('id', subjectId).single();
    expect(s?.name).toBe(`${RUN}-rls`);
    const { data: q } = await owner.from('questions').select('stem, deleted_at').eq('id', questionId).single();
    expect(q).toEqual({ stem: '問題文', deleted_at: null });
    const { data: c } = await owner.from('choices').select('body').eq('question_id', questionId);
    expect(c?.map((r) => r.body).sort()).toEqual(['選択肢1', '選択肢2']);
    const { data: k } = await owner.from('keywords').select('id').eq('id', keywordId);
    expect(k).toHaveLength(1);
    const { data: qk } = await owner.from('question_keywords').select('keyword_id').eq('question_id', questionId);
    expect(qk).toEqual([{ keyword_id: keywordId }]);
  });

  test('別アカウントは所有者の科目・問題へ書き込めず、RPC でも変更できない', async () => {
    const kw = await other.from('keywords').insert({ subject_id: subjectId, name: 'X' });
    expect(kw.error).not.toBeNull();
    const qs = await other
      .from('questions')
      .insert({ subject_id: subjectId, kind: 'keyword', stem: 'x', explanation: 'x' });
    expect(qs.error).not.toBeNull();
    const ch = await other
      .from('choices')
      .insert({ question_id: questionId, position: 9, body: 'x', explanation: 'x', is_correct: false });
    expect(ch.error).not.toBeNull();

    const saved = await saveQuestion(other, subjectId, [keywordId], choices([true, false]), questionId);
    expect(saved.error).not.toBeNull();
    const del = await other.rpc('delete_subject', { p_subject_id: subjectId });
    expect(del.error?.message).toBe('subject_not_found');
    const dis = await other.rpc('set_question_disabled', {
      p_question_id: questionId,
      p_disabled: true,
      p_reason: 'x',
    });
    expect(dis.error?.message).toBe('question_not_found');

    const { data: q } = await owner.from('questions').select('disabled_at').eq('id', questionId).single();
    expect(q?.disabled_at).toBeNull();
  });
});

test.describe('DB 制約', () => {
  let subjectId: string;
  let keywordId: string;

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;
    subjectId = await createSubject('constraint');
    keywordId = await createKeyword(subjectId, 'K');
  });

  test('正解が0個または2個の問題は保存できず、何も残らない', async () => {
    const zero = await saveQuestion(owner, subjectId, [keywordId], choices([false, false]));
    expect(zero.error?.message).toBe('one_correct_required');
    const two = await saveQuestion(owner, subjectId, [keywordId], choices([true, true, false]));
    expect(two.error).not.toBeNull();
    const { data } = await owner.from('questions').select('id').eq('subject_id', subjectId);
    expect(data).toEqual([]);
  });

  test('他科目のキーワードへの紐づけは拒否される', async () => {
    const otherSubject = await createSubject('constraint-other');
    const foreignKeyword = await createKeyword(otherSubject, 'F');
    const res = await saveQuestion(owner, subjectId, [foreignKeyword], choices([true, false]));
    expect(res.error?.message).toBe('keyword_subject_mismatch');

    const { data: qid } = await saveQuestion(owner, subjectId, [keywordId], choices([true, false]));
    const link = await owner.from('question_keywords').insert({ question_id: qid, keyword_id: foreignKeyword });
    expect(link.error?.message).toBe('keyword_subject_mismatch');
    // 他科目のキーワードを親にすることもできない
    const child = await owner.from('keywords').insert({ subject_id: subjectId, parent_id: foreignKeyword, name: 'C' });
    expect(child.error?.message).toBe('keyword_subject_mismatch');
  });

  test('循環する親は拒否される', async () => {
    const a = await createKeyword(subjectId, 'A');
    const b = await createKeyword(subjectId, 'B', a);
    const c = await createKeyword(subjectId, 'C', b);
    const self = await owner.from('keywords').update({ parent_id: a }).eq('id', a);
    expect(self.error?.message).toBe('keyword_cycle');
    const loop = await owner.from('keywords').update({ parent_id: c }).eq('id', a);
    expect(loop.error?.message).toBe('keyword_cycle');
    const moved = await owner.rpc('move_keyword', { p_keyword_id: a, p_new_parent_id: c });
    expect(moved.error).not.toBeNull();
    const { data } = await owner.from('keywords').select('parent_id').eq('id', a).single();
    expect(data?.parent_id).toBeNull();
  });

  test('削除状態の問題の選択肢は残り、出題対象ビューは無効・削除の問題を含まない', async () => {
    const sid = await createSubject('servable');
    const kid = await createKeyword(sid, 'K');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data, error } = await saveQuestion(owner, sid, [kid], choices([true, false]));
      if (error) throw error;
      ids.push(data as string);
    }
    const [active, disabled, deleted] = ids;
    const dis = await owner.rpc('set_question_disabled', { p_question_id: disabled, p_disabled: true, p_reason: '理由' });
    expect(dis.error).toBeNull();
    const del = await owner.from('questions').update({ deleted_at: new Date().toISOString() }).eq('id', deleted);
    expect(del.error).toBeNull();

    const { data: servable } = await owner.from('servable_questions').select('id').eq('subject_id', sid);
    expect(servable?.map((r) => r.id)).toEqual([active]);

    const { data: kept } = await owner.from('choices').select('body, removed_at').eq('question_id', deleted);
    expect(kept).toHaveLength(2);
    expect(kept?.every((r) => r.removed_at === null)).toBe(true);

    // 科目の削除でも問題は削除状態になり、選択肢は残り、出題対象から外れる
    const ds = await owner.rpc('delete_subject', { p_subject_id: sid });
    expect(ds.error).toBeNull();
    const { data: afterServable } = await owner.from('servable_questions').select('id').eq('subject_id', sid);
    expect(afterServable).toEqual([]);
    const { data: q } = await owner.from('questions').select('id, deleted_at').eq('id', active).single();
    expect(q?.deleted_at).not.toBeNull();
    const { data: c } = await owner.from('choices').select('id').eq('question_id', active);
    expect(c).toHaveLength(2);
  });
});

test.describe('部分木関数（深さ10・兄弟1,200件）', () => {
  let rootId: string;
  const expected = new Set<string>();

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;
    test.setTimeout(120_000);
    const sid = await createSubject('tree');
    // 深さ10の鎖（根を深さ1とする）
    const chain: string[] = [];
    let parent: string | null = null;
    for (let d = 1; d <= 10; d++) {
      parent = await createKeyword(sid, `D${d}`, parent);
      chain.push(parent);
    }
    rootId = chain[0]!;
    chain.forEach((id) => expected.add(id));
    // 根の直下に兄弟1,200件（鎖の D2 を含めて 1,201 件の兄弟）を一括挿入する
    const siblings = Array.from({ length: 1200 }, (_, i) => ({
      id: crypto.randomUUID(),
      subject_id: sid,
      parent_id: rootId,
      name: `S${i}`,
      sort_order: i + 1,
    }));
    for (let i = 0; i < siblings.length; i += 300) {
      const { error } = await owner.from('keywords').insert(siblings.slice(i, i + 300));
      if (error) throw error;
    }
    siblings.forEach((s) => expected.add(s.id));
    // 最深部の下にも兄弟を置き、深い位置の兄弟も辿れることを確かめる
    const deep = Array.from({ length: 5 }, (_, i) => ({
      id: crypto.randomUUID(),
      subject_id: sid,
      parent_id: chain[9],
      name: `L${i}`,
      sort_order: i,
    }));
    const { error } = await owner.from('keywords').insert(deep);
    if (error) throw error;
    deep.forEach((s) => expected.add(s.id));
  });

  test('根の部分木は全件を重複なく返す', async () => {
    // PostgREST の max_rows（1,000）を超えるため、1,000件ずつページを取得して連結する
    // （スカラーの setof は order 指定できない。欠落・重複は下の集合比較で検出する）
    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await owner
        .rpc('keyword_subtree_ids', { p_keyword_id: rootId })
        .range(from, from + 999);
      expect(error).toBeNull();
      const page = data as string[];
      ids.push(...page);
      if (page.length < 1000) break;
    }
    expect(ids).toHaveLength(expected.size);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(expected);
  });

  test('存在しない ID は0行を返す', async () => {
    const { data, error } = await owner.rpc('keyword_subtree_ids', { p_keyword_id: crypto.randomUUID() });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

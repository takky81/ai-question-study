import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD } from './helpers';

// quiz-session の RLS・直接書き込みの拒否・SQL 関数・集計ビューを、supabase-js クライアントと
// テスト用の SQL 接続（ローカル Supabase の DB コンテナ内の psql）で直接確認する。
// 画面は使わないため、1つのプロジェクト（desktop）でだけ実行する。
// 解答・SRS・フラグはこのファイルが作る科目の問題にだけ作り、後片付けで消す（seed の問題は読むだけ）。

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EMAIL = 'other@example.com';
const OTHER_PASSWORD = 'other-password-local';
const BULK_SUBJECT_ID = 'b0000000-0000-4000-8000-000000000001';
const NAME_PREFIX = 'quiz-db-';
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_ai-question-study';

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

// ---- テスト用の SQL 接続（postgres として psql を実行する） ----

type SqlResult = { ok: true; rows: string[] } | { ok: false; error: string };

function sql(script: string): SqlResult {
  try {
    const out = execFileSync(
      'docker',
      ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { ok: true, rows: out.split(/\r?\n/).filter((l) => l.length > 0) };
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return { ok: false, error: err.stderr ?? err.message };
  }
}

function sqlOk(script: string): string[] {
  const r = sql(script);
  if (!r.ok) throw new Error(r.error);
  return r.rows;
}

// 所有者の JWT クレームで authenticated として実行する（トランザクション内のみ）
const AS_OWNER = `set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${OWNER_ID}","role":"authenticated"}', true) \\g /dev/null
`;

// このファイルが作った科目（名前の接頭辞で特定）の解答・SRS・フラグを消し、科目ごと物理削除する。
// 直接書き込みと解消済みフラグの変更はトリガーで拒否されるため、postgres でトリガーを止めて消す。
function cleanupSubjects(): void {
  sqlOk(`begin;
set local session_replication_role = replica;
create temp table t_q on commit drop as
  select q.id from public.questions q join public.subjects s on s.id = q.subject_id
  where s.owner_id = '${OWNER_ID}' and s.name like '${NAME_PREFIX}%';
delete from public.answers where question_id in (select id from t_q);
delete from public.srs_states where question_id in (select id from t_q);
delete from public.question_flags where question_id in (select id from t_q);
set local session_replication_role = origin;
delete from public.subjects where owner_id = '${OWNER_ID}' and name like '${NAME_PREFIX}%';
commit;`);
}

// ---- データ作成 ----

const RUN = `${NAME_PREFIX}${Date.now()}`;

let owner: SupabaseClient;
let other: SupabaseClient;

async function createSubject(name: string): Promise<string> {
  const { data, error } = await owner.from('subjects').insert({ name: `${RUN}-${name}` }).select('id').single();
  if (error) throw error;
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

// 正解は先頭の選択肢。作成順を一意にするため1問ずつ作る
async function createQuestion(subjectId: string, keywordIds: string[]): Promise<{ id: string; correct: string; wrong: string }> {
  const { data, error } = await owner.rpc('save_question', {
    p: {
      id: null,
      subjectId,
      kind: 'keyword',
      stem: '問題文',
      explanation: '全体の解説',
      keywordIds,
      choices: [
        { body: '正解', explanation: '解説1', isCorrect: true },
        { body: '誤答', explanation: '解説2', isCorrect: false },
      ],
    },
  });
  if (error) throw error;
  const id = data as string;
  const { data: cs, error: e2 } = await owner.from('choices').select('id, is_correct').eq('question_id', id).order('position');
  if (e2) throw e2;
  const rows = cs as { id: string; is_correct: boolean }[];
  return { id, correct: rows.find((c) => c.is_correct)!.id, wrong: rows.find((c) => !c.is_correct)!.id };
}

type AnswerResult = {
  answer_id: string;
  is_correct: boolean;
  correct_choice_id: string;
  attempt_count: number;
  correct_count: number;
  correct_rate: number | null;
  retention: number | null;
  last_answered_at: string | null;
  already_recorded: boolean;
};

function record(client: SupabaseClient, questionId: string, choiceId: string | null, kind: string, clientAnswerId: string = crypto.randomUUID()) {
  return client.rpc('record_answer', {
    p_client_answer_id: clientAnswerId,
    p_question_id: questionId,
    p_choice_id: choiceId,
    p_kind: kind,
  });
}

async function recordOk(questionId: string, choiceId: string | null, kind: string, clientAnswerId?: string): Promise<AnswerResult> {
  const { data, error } = await record(owner, questionId, choiceId, kind, clientAnswerId);
  if (error) throw error;
  return data as AnswerResult;
}

type Srs = { stability_days: number; ease: number; review_count: number; lapse_count: number; last_reviewed_at: string };

async function srsOf(questionId: string): Promise<Srs | null> {
  const { data, error } = await owner.from('srs_states').select('*').eq('question_id', questionId).maybeSingle();
  if (error) throw error;
  return data as Srs | null;
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await owner.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

// 1,000 行を超える結果を .range で全件取得する
async function fetchAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw error;
    const page = data as T[];
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  // 前回の中断で残ったデータがあれば消す（再実行できるようにする）
  cleanupSubjects();
  owner = await signIn(OWNER_EMAIL, OWNER_PASSWORD);
  other = await signIn(OTHER_EMAIL, OTHER_PASSWORD);
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop' || !owner) return;
  cleanupSubjects();
  await owner.auth.signOut();
  await other.auth.signOut();
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'DB だけを検証するため desktop でのみ実行する');
});

test.describe('srs_next の規則表（3.1、4.2）', () => {
  type Row = [string, string, string, number, number, number, number, number];
  // [説明, 状態, 評価, 経過日数, 期待 stability, ease, review, lapse]
  const rows: Row[] = [
    ['初回の正解', 'null', 'good', 0, 1.0, 2.55, 1, 0],
    ['初回の誤答', 'null', 'again', 0, 0.2, 2.3, 1, 1],
    ['初回のわからない', 'null', 'blackout', 0, 0.2, 2.2, 1, 1],
    ['間隔の半分以上での正解（更新前の ease を掛ける）', 'row(2,2.5,3,1)', 'good', 1, 5.0, 2.55, 4, 1],
    ['早すぎる正解は据え置き', 'row(2,2.5,3,1)', 'good', 0.5, 2.0, 2.55, 4, 1],
    ['ease の上限 3.0', 'row(2,2.98,3,0)', 'good', 2, 5.96, 3.0, 4, 0],
    ['誤答は安定度半分', 'row(4,2.5,3,0)', 'again', 1, 2.0, 2.3, 4, 1],
    ['安定度の下限 0.2', 'row(0.3,2.5,3,0)', 'again', 1, 0.2, 2.3, 4, 1],
    ['ease の下限 1.3（誤答）', 'row(4,1.4,3,0)', 'again', 1, 2.0, 1.3, 4, 1],
    ['わからないは 0.2', 'row(10,2.5,3,2)', 'blackout', 5, 0.2, 2.2, 4, 3],
    ['ease の下限 1.3（わからない）', 'row(10,1.5,3,2)', 'blackout', 5, 0.2, 1.3, 4, 3],
  ];

  test('各規則の行が設計の表どおりに計算される', () => {
    const selects = rows
      .map(([, state, grade, elapsed]) => {
        const s = state === 'null' ? 'null::public.srs_input' : `${state}::public.srs_input`;
        return `select (r).stability_days, (r).ease, (r).review_count, (r).lapse_count from (select quiz_private.srs_next(${s}, '${grade}', ${elapsed}) as r) x;`;
      })
      .join('\n');
    const out = sqlOk(`begin;\n${AS_OWNER}${selects}\ncommit;`);
    expect(out).toHaveLength(rows.length);
    rows.forEach(([label, , , , st, ease, rc, lc], i) => {
      const [a, b, c, d] = out[i]!.split('|').map(Number);
      expect(a, label).toBeCloseTo(st, 9);
      expect(b, label).toBeCloseTo(ease, 9);
      expect(c, label).toBe(rc);
      expect(d, label).toBe(lc);
    });
  });

  test('不正な評価は invalid_grade', () => {
    const r = sql(`begin;\n${AS_OWNER}select quiz_private.srs_next(null, 'hard', 0);\ncommit;`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('invalid_grade');
  });
});

test.describe('解答の記録と集計', () => {
  let subjectId: string;
  let kRoot: string;
  let kMid: string;
  let kT: string;
  let kU: string;
  let kEmpty: string;
  let qMid: Awaited<ReturnType<typeof createQuestion>>; // 途中ノードに紐づく
  let qT: Awaited<ReturnType<typeof createQuestion>>; // T
  let qTU: Awaited<ReturnType<typeof createQuestion>>; // T と U（同じ部分木の2キーワード）
  let qDisable: Awaited<ReturnType<typeof createQuestion>>; // U、後で無効化
  let qDelete: Awaited<ReturnType<typeof createQuestion>>; // T、後で削除
  let qGuess: Awaited<ReturnType<typeof createQuestion>>; // U、「？」だけで解く
  let qNone: Awaited<ReturnType<typeof createQuestion>>; // U、未出題のまま

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop') return;
    subjectId = await createSubject('main');
    kRoot = await createKeyword(subjectId, 'ルート');
    kMid = await createKeyword(subjectId, '途中', kRoot);
    kT = await createKeyword(subjectId, 'T', kMid);
    kU = await createKeyword(subjectId, 'U', kMid);
    kEmpty = await createKeyword(subjectId, '空', kRoot);
    qMid = await createQuestion(subjectId, [kMid]);
    qT = await createQuestion(subjectId, [kT]);
    qTU = await createQuestion(subjectId, [kT, kU]);
    qDisable = await createQuestion(subjectId, [kU]);
    qDelete = await createQuestion(subjectId, [kT]);
    qGuess = await createQuestion(subjectId, [kU]);
    qNone = await createQuestion(subjectId, [kU]);
  });

  test('正解で SRS が作られ、誤答・わからないで更新される（3.1、4.2）', async () => {
    const r1 = await recordOk(qT.id, qT.correct, 'normal');
    expect(r1).toMatchObject({ is_correct: true, correct_choice_id: qT.correct, attempt_count: 1, correct_count: 1, correct_rate: 1, already_recorded: false });
    expect(r1.retention).not.toBeNull();
    let s = await srsOf(qT.id);
    expect(s).toMatchObject({ stability_days: 1, ease: 2.55, review_count: 1, lapse_count: 0 });

    const r2 = await recordOk(qT.id, qT.wrong, 'normal');
    expect(r2).toMatchObject({ is_correct: false, correct_choice_id: qT.correct, attempt_count: 2, correct_count: 1, correct_rate: 0.5 });
    s = await srsOf(qT.id);
    expect(s!.stability_days).toBeCloseTo(0.5, 9);
    expect(s!.ease).toBeCloseTo(2.35, 9);
    expect(s).toMatchObject({ review_count: 2, lapse_count: 1 });

    const r3 = await recordOk(qT.id, null, 'unknown');
    expect(r3).toMatchObject({ is_correct: false, attempt_count: 3, correct_count: 1 });
    s = await srsOf(qT.id);
    expect(s!.stability_days).toBeCloseTo(0.2, 9);
    expect(s!.ease).toBeCloseTo(2.05, 9);
    expect(s).toMatchObject({ review_count: 3, lapse_count: 2 });

    const { data: hist } = await owner.from('answers').select('answer_kind, is_correct, choice_id').eq('question_id', qT.id).order('answered_at');
    expect(hist).toEqual([
      { answer_kind: 'normal', is_correct: true, choice_id: qT.correct },
      { answer_kind: 'normal', is_correct: false, choice_id: qT.wrong },
      { answer_kind: 'unknown', is_correct: false, choice_id: null },
    ]);
  });

  test('「？」エリアの解答は SRS を変えず guessable を1件だけ付ける（4.4、4.5）', async () => {
    const r = await recordOk(qGuess.id, qGuess.correct, 'guess');
    expect(r).toMatchObject({ is_correct: true, attempt_count: 1, correct_count: 1, retention: null });
    await recordOk(qGuess.id, qGuess.wrong, 'guess');
    expect(await srsOf(qGuess.id)).toBeNull();
    const { data: flags } = await owner.from('question_flags').select('flag, status').eq('question_id', qGuess.id);
    expect(flags).toEqual([{ flag: 'guessable', status: 'open' }]);

    // SRS 状態のある問題でも「？」は SRS を変えない
    await recordOk(qMid.id, qMid.correct, 'normal');
    const before = await srsOf(qMid.id);
    await recordOk(qMid.id, qMid.wrong, 'guess');
    expect(await srsOf(qMid.id)).toEqual(before);
  });

  test('同じ client_answer_id の2回の呼び出しで1件だけ記録される（3.4）', async () => {
    const key = crypto.randomUUID();
    const first = await recordOk(qTU.id, qTU.correct, 'normal', key);
    const srs = await srsOf(qTU.id);
    const second = await recordOk(qTU.id, qTU.wrong, 'normal', key);
    expect(second.already_recorded).toBe(true);
    expect(second.answer_id).toBe(first.answer_id);
    expect(second.is_correct).toBe(true);
    expect(second.attempt_count).toBe(1);
    expect(await countRows('answers', 'question_id', qTU.id)).toBe(1);
    expect(await srsOf(qTU.id)).toEqual(srs);
  });

  test('他の問題の選択肢・不正な種類は拒否され何も記録されない（3.2）', async () => {
    const before = await countRows('answers', 'question_id', qNone.id);
    const { error } = await record(owner, qNone.id, qT.correct, 'normal');
    expect(error?.message).toBe('choice_not_in_question');
    const { error: e2 } = await record(owner, qNone.id, qNone.correct, 'unknown');
    expect(e2?.message).toBe('choice_not_in_question');
    const { error: e3 } = await record(owner, qNone.id, qNone.correct, 'bogus');
    expect(e3?.message).toBe('invalid_answer_kind');
    expect(await countRows('answers', 'question_id', qNone.id)).toBe(before);
    expect(await srsOf(qNone.id)).toBeNull();
    expect(await countRows('question_flags', 'question_id', qNone.id)).toBe(0);
  });

  test('別アカウントからは記録できず、所有者の履歴・SRS・フラグ・集計が見えない（3.6、7.8、9.6）', async () => {
    const { error } = await record(other, qT.id, qT.correct, 'normal');
    expect(error?.message).toBe('question_not_servable');
    for (const [table, column, value] of [
      ['answers', 'question_id', qT.id],
      ['srs_states', 'question_id', qT.id],
      ['question_flags', 'question_id', qGuess.id],
      ['question_stats', 'question_id', qT.id],
      ['keyword_stats', 'keyword_id', kRoot],
    ] as const) {
      const { data, error: e } = await other.from(table).select('*').eq(column, value);
      expect(e, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    // 別アカウントの全件でも所有者の行は含まれない
    const { data: anyAnswers } = await other.from('answers').select('owner_id');
    expect((anyAnswers as { owner_id: string }[]).every((a) => a.owner_id !== OWNER_ID)).toBe(true);
    const { data: candidates } = await other.rpc('list_quiz_candidates', { p_subject_id: subjectId, p_keyword_id: null });
    expect(candidates).toEqual([]);
    const { error: flagErr } = await other.rpc('save_question_flags', { p_question_id: qT.id, p_flags: ['low_value'], p_comment: null });
    expect(flagErr?.message).toBe('question_not_found');
    expect(await countRows('question_flags', 'question_id', qT.id)).toBe(0);
  });

  test('3テーブルへの直接の insert／update／delete は direct_write_forbidden（3.2）', async () => {
    const { data: ans } = await owner.from('answers').select('id').eq('question_id', qT.id).limit(1).single();
    const answerId = (ans as { id: string }).id;
    const { data: flag } = await owner.from('question_flags').select('id').eq('question_id', qGuess.id).single();
    const flagId = (flag as { id: string }).id;

    const attempts = [
      owner.from('answers').insert({ question_id: qNone.id, choice_id: qNone.correct, answer_kind: 'normal', is_correct: true, client_answer_id: crypto.randomUUID() }),
      owner.from('answers').update({ is_correct: true }).eq('id', answerId),
      owner.from('answers').delete().eq('id', answerId),
      owner.from('srs_states').insert({ question_id: qNone.id, stability_days: 100, ease: 3, review_count: 1, lapse_count: 0, last_reviewed_at: new Date().toISOString() }),
      owner.from('srs_states').update({ stability_days: 100 }).eq('question_id', qT.id),
      owner.from('srs_states').delete().eq('question_id', qT.id),
      owner.from('question_flags').insert({ question_id: qNone.id, flag: 'low_value' }),
      owner.from('question_flags').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', flagId),
      owner.from('question_flags').delete().eq('id', flagId),
    ];
    for (const [i, p] of attempts.entries()) {
      const { error } = await p;
      expect(error?.message, `attempt ${i}`).toBe('direct_write_forbidden');
    }
    expect(await countRows('answers', 'question_id', qT.id)).toBe(3);
    expect((await srsOf(qT.id))!.review_count).toBe(3);
    expect(await srsOf(qNone.id)).toBeNull();
    expect(await countRows('question_flags', 'question_id', qGuess.id)).toBe(1);
  });

  test('question_stats の各列と未出題の値（2.6、2.7、9.1、9.5）', async () => {
    const { data, error } = await owner.from('question_stats').select('*').eq('subject_id', subjectId);
    expect(error).toBeNull();
    const rows = data as Record<string, unknown>[];
    expect(rows.map((r) => r.question_id).sort()).toEqual(
      [qMid, qT, qTU, qDisable, qDelete, qGuess, qNone].map((q) => q.id).sort(),
    );
    const byId = new Map(rows.map((r) => [r.question_id, r]));
    const t = byId.get(qT.id)!;
    expect(t).toMatchObject({ attempt_count: 3, correct_count: 1, review_count: 3 });
    expect(t.correct_rate).toBeCloseTo(1 / 3, 9);
    expect(typeof t.retention).toBe('number');
    expect(t.retention as number).toBeGreaterThan(0);
    expect(t.retention as number).toBeLessThanOrEqual(1);
    expect(Date.parse(t.last_answered_at as string)).not.toBeNaN();
    expect(byId.get(qGuess.id)).toMatchObject({ attempt_count: 2, correct_count: 1, correct_rate: 0.5, review_count: 0, retention: null });
    expect(byId.get(qNone.id)).toMatchObject({ attempt_count: 0, correct_count: 0, correct_rate: null, review_count: 0, retention: null, last_answered_at: null });

    // 候補も同じ値を作成順で返す
    const { data: cands } = await owner.rpc('list_quiz_candidates', { p_subject_id: subjectId, p_keyword_id: kU });
    expect((cands as { question_id: string }[]).map((c) => c.question_id)).toEqual([qTU.id, qDisable.id, qGuess.id, qNone.id]);
  });

  test('keyword_stats は部分木を重複なく数え、0件は0と null（9.2、9.3、9.5）', async () => {
    // 先に qDisable・qDelete にも解答しておく（後の除外の確認用）
    await recordOk(qDisable.id, qDisable.correct, 'normal');
    await recordOk(qDelete.id, qDelete.correct, 'normal');

    const { data, error } = await owner.from('keyword_stats').select('*').eq('subject_id', subjectId);
    expect(error).toBeNull();
    const byId = new Map((data as Record<string, unknown>[]).map((r) => [r.keyword_id, r]));
    // 解答: qMid 2(1正) / qT 3(1正) / qTU 1(1正) / qDisable 1(1正) / qDelete 1(1正) / qGuess 2(1正) / qNone 0
    // T: qT、qTU、qDelete
    expect(byId.get(kT)).toMatchObject({ question_count: 3, attempt_count: 5, correct_count: 3 });
    // U: qTU、qDisable、qGuess、qNone
    expect(byId.get(kU)).toMatchObject({ question_count: 4, attempt_count: 4, correct_count: 3 });
    // 途中: qMid と配下（qTU は1回だけ）
    expect(byId.get(kMid)).toMatchObject({ question_count: 7, attempt_count: 10, correct_count: 6 });
    expect(byId.get(kMid)!.correct_rate).toBeCloseTo(0.6, 9);
    expect(byId.get(kRoot)).toMatchObject({ question_count: 7, attempt_count: 10, correct_count: 6 });
    expect(byId.get(kEmpty)).toMatchObject({ question_count: 0, attempt_count: 0, correct_count: 0, correct_rate: null });
  });

  test('無効化後は記録を拒否し、無効化・削除後も履歴が残り集計から除外される（3.7、4.5、9.4）', async () => {
    const { error: dErr } = await owner.rpc('set_question_disabled', { p_question_id: qDisable.id, p_disabled: true, p_reason: 'E2E' });
    expect(dErr).toBeNull();
    const { error: delErr } = await owner.from('questions').update({ deleted_at: new Date().toISOString() }).eq('id', qDelete.id);
    expect(delErr).toBeNull();

    const { error } = await record(owner, qDisable.id, qDisable.correct, 'normal');
    expect(error?.message).toBe('question_not_servable');
    const { error: e2 } = await record(owner, qDelete.id, qDelete.correct, 'guess');
    expect(e2?.message).toBe('question_not_servable');

    expect(await countRows('answers', 'question_id', qDisable.id)).toBe(1);
    expect(await countRows('answers', 'question_id', qDelete.id)).toBe(1);
    expect(await srsOf(qDisable.id)).not.toBeNull();

    const { data: qs } = await owner.from('question_stats').select('question_id').in('question_id', [qDisable.id, qDelete.id]);
    expect(qs).toEqual([]);
    const { data: ks } = await owner.from('keyword_stats').select('*').eq('subject_id', subjectId);
    const byId = new Map((ks as Record<string, unknown>[]).map((r) => [r.keyword_id, r]));
    expect(byId.get(kT)).toMatchObject({ question_count: 2, attempt_count: 4, correct_count: 2 });
    expect(byId.get(kU)).toMatchObject({ question_count: 3, attempt_count: 3, correct_count: 2 });
    expect(byId.get(kMid)).toMatchObject({ question_count: 5, attempt_count: 8, correct_count: 4 });
    const { data: cands } = await owner.rpc('list_quiz_candidates', { p_subject_id: subjectId, p_keyword_id: null });
    expect((cands as { question_id: string }[]).map((c) => c.question_id)).toEqual([qMid.id, qT.id, qTU.id, qGuess.id, qNone.id]);
  });

  test('フラグ解消関数はクライアントから呼べない（8.4）', async () => {
    const { error } = await owner.rpc('resolve_question_flags', { p_question_ids: [qGuess.id] });
    expect(error).not.toBeNull();
    const { error: e2 } = await owner.schema('quiz_private').rpc('resolve_question_flags', { p_question_ids: [qGuess.id] });
    expect(e2).not.toBeNull();
    const { data } = await owner.from('question_flags').select('status').eq('question_id', qGuess.id);
    expect(data).toEqual([{ status: 'open' }]);
  });

  test('SQL 接続: 失敗したトランザクションの解消はロールバックされ、成功時は open だけが解消される（8.1〜8.3、8.5）', async () => {
    const { error } = await owner.rpc('save_question_flags', { p_question_id: qGuess.id, p_flags: ['guessable', 'defective'], p_comment: 'メモ' });
    expect(error).toBeNull();

    // 例外で終わるトランザクション（取込の失敗に相当）
    const failed = sql(`begin;\n${AS_OWNER}select quiz_private.resolve_question_flags(array['${qGuess.id}']::uuid[]);\nselect 1/0;\ncommit;`);
    expect(failed.ok).toBe(false);
    const { data: still } = await owner.from('question_flags').select('flag, status, resolved_at').eq('question_id', qGuess.id).order('flag');
    expect(still).toEqual([
      { flag: 'comment', status: 'open', resolved_at: null },
      { flag: 'defective', status: 'open', resolved_at: null },
      { flag: 'guessable', status: 'open', resolved_at: null },
    ]);

    // 成功するトランザクション
    const first = sqlOk(`begin;\n${AS_OWNER}select quiz_private.resolve_question_flags(array['${qGuess.id}']::uuid[]);\ncommit;`);
    expect(first).toEqual(['3']);
    const { data: resolved1 } = await owner.from('question_flags').select('id, status, resolved_at').eq('question_id', qGuess.id);
    const r1 = resolved1 as { id: string; status: string; resolved_at: string | null }[];
    expect(r1).toHaveLength(3);
    expect(r1.every((f) => f.status === 'resolved' && f.resolved_at !== null && !Number.isNaN(Date.parse(f.resolved_at)))).toBe(true);

    // 新しい未解消フラグ（同じ識別子も可）を作り、再度解消すると open だけが対象になる
    await recordOk(qGuess.id, qGuess.correct, 'guess');
    const second = sqlOk(`begin;\n${AS_OWNER}select quiz_private.resolve_question_flags(array['${qGuess.id}']::uuid[]);\ncommit;`);
    expect(second).toEqual(['1']);
    const { data: all } = await owner.from('question_flags').select('id, status, resolved_at').eq('question_id', qGuess.id);
    const rows = all as { id: string; status: string; resolved_at: string | null }[];
    expect(rows).toHaveLength(4);
    for (const old of r1) {
      const now = rows.find((r) => r.id === old.id)!;
      expect(Date.parse(now.resolved_at!)).toBe(Date.parse(old.resolved_at!));
    }

    // 解消済みは RPC 経由（GUC あり）でも変更・削除できず、保存 RPC でも消えない
    const upd = sql(`begin;\n${AS_OWNER}select set_config('quiz.write_via_rpc', 'on', true) \\g /dev/null\nupdate public.question_flags set note = 'x' where id = '${r1[0]!.id}';\ncommit;`);
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error).toContain('resolved_flag_immutable');
    const del = sql(`begin;\n${AS_OWNER}select set_config('quiz.write_via_rpc', 'on', true) \\g /dev/null\ndelete from public.question_flags where id = '${r1[0]!.id}';\ncommit;`);
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error).toContain('resolved_flag_immutable');
    const { error: saveErr } = await owner.rpc('save_question_flags', { p_question_id: qGuess.id, p_flags: [], p_comment: '' });
    expect(saveErr).toBeNull();
    const { data: after } = await owner.from('question_flags').select('status').eq('question_id', qGuess.id);
    expect((after as { status: string }[]).map((r) => r.status)).toEqual(['resolved', 'resolved', 'resolved', 'resolved']);
  });
});

test.describe('大量データの全件取得（9.7）', () => {
  test('候補・question_stats・keyword_stats を欠落・重複なく全件取得できる', async () => {
    const expectedQ = new Set(Array.from({ length: 1050 }, (_, i) => `b2000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`));
    const expectedK = new Set(Array.from({ length: 1200 }, (_, i) => `b1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`));

    const cands = await fetchAllPages<{ question_id: string }>((from, to) =>
      owner.rpc('list_quiz_candidates', { p_subject_id: BULK_SUBJECT_ID, p_keyword_id: null }).range(from, to),
    );
    const qs = await fetchAllPages<{ question_id: string }>((from, to) =>
      owner.from('question_stats').select('question_id').eq('subject_id', BULK_SUBJECT_ID).order('question_id').range(from, to),
    );
    const ks = await fetchAllPages<{ keyword_id: string; question_count: number }>((from, to) =>
      owner.from('keyword_stats').select('keyword_id, question_count').eq('subject_id', BULK_SUBJECT_ID).order('keyword_id').range(from, to),
    );

    for (const [label, ids, expected] of [
      ['candidates', cands.map((c) => c.question_id), expectedQ],
      ['question_stats', qs.map((r) => r.question_id), expectedQ],
      ['keyword_stats', ks.map((r) => r.keyword_id), expectedK],
    ] as const) {
      expect(ids, label).toHaveLength(expected.size);
      expect(new Set(ids).size, label).toBe(ids.length);
      expect(new Set(ids), label).toEqual(expected);
    }
    // ルート 40 件の部分木の問題数の合計は全問題数に一致する
    const rootTotal = ks.filter((k) => Number(k.keyword_id.slice(-12)) <= 40).reduce((s, k) => s + k.question_count, 0);
    expect(rootTotal).toBe(1050);
  });
});

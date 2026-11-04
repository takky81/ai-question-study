import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OWNER_EMAIL, OWNER_PASSWORD } from './helpers';

// learning-stats の区間関数・件数の一致・RLS・権限・大量データを、supabase-js クライアントと
// テスト用の SQL 接続（ローカル Supabase の DB コンテナ内の psql）で直接確認する。
// 画面は使わないため desktop でだけ実行する。seed は読むだけで書き換えない。
// 範囲を変えた検証用に、実行ごとに接頭辞付きの科目を作り、後片付けで消す。

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EMAIL = 'other@example.com';
const OTHER_PASSWORD = 'other-password-local';
const STATS_SUBJECT_ID = 'd0000000-0000-4000-8000-000000000001';
const QUIZ_SUBJECT_ID = 'a0000000-0000-4000-8000-000000000001';
const BULK_SUBJECT_ID = 'b0000000-0000-4000-8000-000000000001';
const MIDDLE_KEYWORD_ID = 'd0000000-0000-4000-8000-00000000c102';
const UNUSED_KEYWORD_ID = 'd0000000-0000-4000-8000-00000000c106';
const NAME_PREFIX = 'stats-db-';
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

function newClient(): SupabaseClient {
  const { url, key } = loadEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

// ---- テスト用の SQL 接続（postgres として psql を実行する） ----

function sqlOk(script: string): string[] {
  const out = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return out.split(/\r?\n/).filter((l) => l.length > 0);
}

// 所有者の JWT クレームで authenticated として実行する（トランザクション内のみ）
function asOwner(query: string): string[] {
  return sqlOk(`begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${OWNER_ID}","role":"authenticated"}', true) \\g /dev/null
${query}
rollback;`);
}

// このファイルが作った科目（名前の接頭辞で特定）の解答などを消し、科目ごと物理削除する。
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

const RUN = `${NAME_PREFIX}${Date.now()}`;
const RUN_SUBJECT_ID = crypto.randomUUID();
const RUN_ROOT_ID = crypto.randomUUID();
const RUN_CHILD_ID = crypto.randomUUID();

// 実行ごとの科目: ルート → 子のキーワード、子に紐づく問題 2 問（3 回中 1 正解、未出題）、ルートに紐づく問題 1 問（1 回正解）
function createRunSubject(): void {
  sqlOk(`begin;
insert into public.subjects (id, owner_id, name) values ('${RUN_SUBJECT_ID}', '${OWNER_ID}', '${RUN}');
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order)
  values ('${RUN_ROOT_ID}', '${OWNER_ID}', '${RUN_SUBJECT_ID}', null, 'ルート', 0);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order)
  values ('${RUN_CHILD_ID}', '${OWNER_ID}', '${RUN_SUBJECT_ID}', '${RUN_ROOT_ID}', '子', 0);
create temp table t_new (n int, qid uuid, kw uuid) on commit drop;
insert into t_new values (1, gen_random_uuid(), '${RUN_CHILD_ID}'), (2, gen_random_uuid(), '${RUN_CHILD_ID}'),
  (3, gen_random_uuid(), '${RUN_ROOT_ID}');
insert into public.questions (id, owner_id, subject_id, kind, stem, explanation)
  select qid, '${OWNER_ID}', '${RUN_SUBJECT_ID}', 'keyword', '問題 ' || n, '解説' from t_new;
insert into public.choices (owner_id, question_id, position, body, explanation, is_correct)
  select '${OWNER_ID}', qid, p, '選択肢 ' || p, '解説', p = 1 from t_new, generate_series(0, 1) as p;
insert into public.question_keywords (question_id, keyword_id, owner_id) select qid, kw, '${OWNER_ID}' from t_new;
select set_config('quiz.write_via_rpc', 'on', true) \\g /dev/null
insert into public.answers (owner_id, question_id, choice_id, answer_kind, is_correct, client_answer_id, answered_at)
select '${OWNER_ID}', h.qid, c.id, 'normal', h.ok, gen_random_uuid(), now() - make_interval(mins => h.i)
from (
  select qid, i, i = 1 as ok from t_new, generate_series(1, 3) as i where n = 1
  union all select qid, 1, true from t_new where n = 3
) as h
join public.choices c on c.question_id = h.qid and c.position = case when h.ok then 1 else 0 end;
commit;`);
}

// 科目・範囲ごとに、ヒストグラムの合計と対象数、各区間の件数と一覧の件数の不一致を数える
function mismatches(subjectId: string, keywordId: string | null): { checked: number; bad: string[] } {
  const kw = keywordId === null ? 'null::uuid' : `'${keywordId}'::uuid`;
  const rows = asOwner(`
with h as (select * from public.stats_histograms('${subjectId}', ${kw})),
sums as (
  select h.target, h.metric, sum(h.item_count)::int as total,
    (select count(*)::int from stats_private.target_items(h.target, '${subjectId}', ${kw})) as targets
  from h group by h.target, h.metric
),
per_bin as (
  select h.target, h.metric, h.bin, h.item_count,
    (select count(*)::int from public.stats_bin_items(h.target, h.metric, h.bin, '${subjectId}', ${kw})) as listed
  from h
)
select 'checked|' || ((select count(*) from sums) + (select count(*) from per_bin))
union all
select 'sum|' || target || '|' || metric || '|' || total || '|' || targets from sums where total <> targets
union all
select 'bin|' || target || '|' || metric || '|' || bin || '|' || item_count || '|' || listed
from per_bin where item_count <> listed;`);
  const checked = Number(rows[0]?.split('|')[1] ?? '0');
  return { checked, bad: rows.slice(1) };
}

let owner: SupabaseClient;
let other: SupabaseClient;

test.describe.configure({ mode: 'serial' });

function desktopOnly(): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'DB だけを検証するため desktop でのみ実行する');
  });
}

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  // 前回の中断で残ったデータがあれば消す（再実行できるようにする）
  cleanupSubjects();
  createRunSubject();
  owner = await signIn(OWNER_EMAIL, OWNER_PASSWORD);
  other = await signIn(OTHER_EMAIL, OTHER_PASSWORD);
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  cleanupSubjects();
  await owner?.auth.signOut();
  await other?.auth.signOut();
});

test.describe('区間関数の境界値（4.1、4.2）', () => {
  desktopOnly();

  test('rate_bin は整数から区間を求め、出題数 0 は未出題、90%〜100% は区間 9 になる', () => {
    const cases: [number, number, number][] = [
      [0, 0, -1],
      [0, 1, 0],
      [1, 1, 9],
      [1, 10, 1],
      [9, 10, 9],
      [10, 10, 9],
      [89, 100, 8],
      [99, 100, 9],
      [1, 3, 3],
      [2, 3, 6],
    ];
    const cs = cases.map(([c]) => c).join(',');
    const as = cases.map(([, a]) => a).join(',');
    const rows = asOwner(
      `select stats_private.rate_bin(c, a) from unnest(array[${cs}], array[${as}]) with ordinality as o(c, a, n) order by n;`,
    );
    expect(rows.map(Number)).toEqual(cases.map(([, , e]) => e));
  });

  test('count_bin は 0 回を 0、k を 2^(k-1)〜2^k-1 回に振り分ける', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
      [7, 3],
      [8, 4],
      [15, 4],
      [16, 5],
      [1073741823, 30],
      [1073741824, 31],
    ];
    const as = cases.map(([a]) => a).join(',');
    const rows = asOwner(
      `select stats_private.count_bin(a) from unnest(array[${as}]) with ordinality as o(a, n) order by n;`,
    );
    expect(rows.map(Number)).toEqual(cases.map(([, e]) => e));
  });
});

test.describe('件数の一致（4.3、5.5）', () => {
  desktopOnly();

  const scopes: [string, () => string, string | null][] = [
    ['統計検証・範囲なし', () => STATS_SUBJECT_ID, null],
    ['統計検証・途中ノード', () => STATS_SUBJECT_ID, MIDDLE_KEYWORD_ID],
    ['統計検証・問題のないキーワード', () => STATS_SUBJECT_ID, UNUSED_KEYWORD_ID],
    ['E2E 出題テスト・範囲なし', () => QUIZ_SUBJECT_ID, null],
    ['実行ごとの科目・範囲なし', () => RUN_SUBJECT_ID, null],
    ['実行ごとの科目・ルート', () => RUN_SUBJECT_ID, RUN_ROOT_ID],
  ];
  for (const [label, subject, keyword] of scopes) {
    test(`${label}: 合計が対象数に、一覧の件数が区間の件数に等しい`, () => {
      const r = mismatches(subject(), keyword);
      expect(r.bad).toEqual([]);
      // 設問・キーワードの正答率は各 11 区間、出題回数は 1 区間以上
      expect(r.checked).toBeGreaterThanOrEqual(4 + 22 + 2);
    });
  }

  test('実行ごとの科目で区間の件数が作成した解答どおりになる', () => {
    const rows = asOwner(
      `select target || ':' || metric || ':' || bin || '=' || item_count
       from public.stats_histograms('${RUN_SUBJECT_ID}', null) where item_count > 0;`,
    );
    expect(rows.sort()).toEqual(
      [
        // 設問: 1/3（区間 3、出題回数区間 2）、未出題、1/1（区間 9、出題回数区間 1）
        'question:correct_rate:-1=1',
        'question:correct_rate:3=1',
        'question:correct_rate:9=1',
        'question:attempt_count:0=1',
        'question:attempt_count:1=1',
        'question:attempt_count:2=1',
        // キーワード: 子 3 回・1 正解（3、2）、ルート 4 回・2 正解（5、3）
        'keyword:correct_rate:3=1',
        'keyword:correct_rate:5=1',
        'keyword:attempt_count:2=1',
        'keyword:attempt_count:3=1',
      ].sort(),
    );
  });
});

test.describe('RLS と権限', () => {
  desktopOnly();

  test('他の所有者のセッションでは所有者の科目が全区間 0 件で、一覧が空になる', async () => {
    const { data, error } = await other.rpc('stats_histograms', {
      p_subject_id: STATS_SUBJECT_ID,
      p_keyword_id: null,
    });
    expect(error).toBeNull();
    const rows = data as { target: string; metric: string; bin: number; item_count: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.item_count === 0)).toBe(true);
    // 所有者のセッションでは件数がある（seed の対象数 10）
    const own = await owner.rpc('stats_histograms', { p_subject_id: STATS_SUBJECT_ID, p_keyword_id: null });
    expect(own.error).toBeNull();
    const ownRows = own.data as typeof rows;
    const sum = (t: string) =>
      ownRows.filter((r) => r.target === t && r.metric === 'correct_rate').reduce((a, r) => a + r.item_count, 0);
    expect(sum('question')).toBe(10);
    expect(sum('keyword')).toBe(5);

    for (const [target, metric, bin] of [
      ['question', 'correct_rate', 9],
      ['question', 'correct_rate', -1],
      ['question', 'attempt_count', 4],
      ['keyword', 'correct_rate', 9],
    ] as const) {
      const r = await other.rpc('stats_bin_items', {
        p_target: target,
        p_metric: metric,
        p_bin: bin,
        p_subject_id: STATS_SUBJECT_ID,
        p_keyword_id: null,
      });
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
    }
  });

  test('内部関数はクライアントから呼べない（stats_private は公開されない）', async () => {
    for (const [fn, args] of [
      ['rate_bin', { p_correct: 1, p_attempt: 1 }],
      ['count_bin', { p_attempt: 1 }],
      ['target_items', { p_target: 'question', p_subject_id: STATS_SUBJECT_ID, p_keyword_id: null }],
    ] as const) {
      const r = await owner.schema('stats_private').rpc(fn, args);
      expect(r.error).not.toBeNull();
      expect(r.data).toBeNull();
    }
    // public 経由の同名でも呼べない
    const r = await owner.rpc('rate_bin', { p_correct: 1, p_attempt: 1 });
    expect(r.error).not.toBeNull();
  });

  test('匿名からは RPC が呼べない', async () => {
    const anon = newClient();
    const h = await anon.rpc('stats_histograms', { p_subject_id: STATS_SUBJECT_ID, p_keyword_id: null });
    expect(h.error).not.toBeNull();
    expect(h.data).toBeNull();
    const b = await anon.rpc('stats_bin_items', {
      p_target: 'question',
      p_metric: 'correct_rate',
      p_bin: 9,
      p_subject_id: STATS_SUBJECT_ID,
      p_keyword_id: null,
    });
    expect(b.error).not.toBeNull();
    expect(b.data).toBeNull();
  });

  test('不正な対象・指標は拒否される', async () => {
    const call = (target: string | null, metric: string | null) =>
      owner.rpc('stats_bin_items', {
        p_target: target,
        p_metric: metric,
        p_bin: 0,
        p_subject_id: STATS_SUBJECT_ID,
        p_keyword_id: null,
      });
    for (const target of ['subject', '', null]) {
      const r = await call(target, 'correct_rate');
      expect(r.error?.message).toBe('invalid_stats_target');
    }
    for (const metric of ['retention', '', null]) {
      const r = await call('question', metric);
      expect(r.error?.message).toBe('invalid_stats_metric');
    }
  });
});

test.describe('大量データ（3.5、6.1）', () => {
  desktopOnly();

  test('1,200 キーワードの科目で、キーワードの件数合計が問題の紐づくキーワード数と一致する', async () => {
    const counts = asOwner(`
select count(*) from public.keywords where subject_id = '${BULK_SUBJECT_ID}';
select count(*) from public.keyword_stats where subject_id = '${BULK_SUBJECT_ID}' and question_count > 0;`);
    expect(Number(counts[0])).toBe(1200);
    const linked = Number(counts[1]);
    // 子 1,050 件と、その親のルート 40 件
    expect(linked).toBe(1090);

    const { data, error } = await owner.rpc('stats_histograms', { p_subject_id: BULK_SUBJECT_ID, p_keyword_id: null });
    expect(error).toBeNull();
    const rows = data as { target: string; metric: string; bin: number; item_count: number }[];
    for (const metric of ['correct_rate', 'attempt_count']) {
      const sum = rows
        .filter((r) => r.target === 'keyword' && r.metric === metric)
        .reduce((a, r) => a + r.item_count, 0);
      expect(sum).toBe(linked);
    }
    const q = rows.filter((r) => r.target === 'question' && r.metric === 'correct_rate');
    expect(q.reduce((a, r) => a + r.item_count, 0)).toBe(1050);
  });
});

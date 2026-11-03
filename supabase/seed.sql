-- ローカル開発用の seed。spec ごとにコメントで区切った節に追記し、他 spec の節は書き換えない。
-- このファイルはローカルの `supabase db reset` でのみ適用され、本番には適用しない。

-- ============================================================
-- app-foundation: ローカル専用の所有者アカウント
-- メール: owner@example.com / パスワード: owner-password-local（E2E でも使う固定値。秘密情報ではない）
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'owner@example.com',
  extensions.crypt('owner-password-local', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}',
  now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'email',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"owner@example.com","email_verified":true}',
  now(), now(), now()
);
-- ============================================================
-- app-foundation ここまで
-- ============================================================

-- ============================================================
-- subject-catalog: RLS 検証用の2人目のローカル専用アカウント
-- メール: other@example.com / パスワード: other-password-local（テストで使う固定値。秘密情報ではない）
-- 所有者アカウントと同じ方式で作成し、科目や問題は持たせない
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-4222-8222-222222222222',
  'authenticated', 'authenticated', 'other@example.com',
  extensions.crypt('other-password-local', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}',
  now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'email',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"other@example.com","email_verified":true}',
  now(), now(), now()
);
-- ============================================================
-- subject-catalog ここまで
-- ============================================================

-- ============================================================
-- quiz-session: 出題・集計の E2E 用データ（所有者アカウントの科目）
-- seed は postgres で実行され RLS を通らないため、owner_id を明示する。
-- 解答・SRS・問題フラグは RPC 経由の書き込みに限るため、ここでは作らない。
--
-- 科目「E2E 出題テスト」（a0000000-0000-4000-8000-000000000001）
--   キーワード木:
--     ネットワーク（…a101）
--       プロトコル（…a102、途中ノード）
--         TCP（…a103）
--         UDP（…a104）
--     セキュリティ（…a105）
--     未使用（…a106、紐づく問題なし）
--   問題（作成日時は q1 → q7 の順）:
--     q1（…b001）出題対象: プロトコル（途中ノード）
--     q2（…b002）出題対象: TCP
--     q3（…b003）出題対象: TCP と UDP（同じ部分木の複数キーワード）
--     q4（…b004）無効:     UDP
--     q5（…b005）削除:     TCP
--     q6（…b006）出題対象: セキュリティ
--     q7（…b007）出題対象: キーワードなし
--   出題対象の件数: 科目全体 5、ネットワーク・プロトコル 3、TCP 2、UDP 1、セキュリティ 1、未使用 0
--   選択肢は各問 4 個（position 0〜3）、正解は position 1
--
-- 科目「E2E 大量データ」（b0000000-0000-4000-8000-000000000001）
--   キーワード 1,200 件: ルート R001〜R040（40 件）と、各ルートの子 C0041〜C1200（1,160 件）
--     ID は b1000000-0000-4000-8000-{n を 12 桁}、子 n の親はルート ((n - 41) % 40) + 1
--   問題 1,050 件（すべて出題対象）: 問題 n は子キーワード ((n - 1) % 1160) + 41 に紐づく
--     ID は b2000000-0000-4000-8000-{n を 12 桁}、選択肢は各 4 個で正解は position 1
-- ============================================================
insert into public.subjects (id, owner_id, name, created_at, updated_at) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'E2E 出題テスト', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'E2E 大量データ', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00');

-- 親を先に挿入する（親の検査トリガーが親の行を参照するため）
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('a0000000-0000-4000-8000-00000000a101', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', null, 'ネットワーク', 0),
  ('a0000000-0000-4000-8000-00000000a105', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', null, 'セキュリティ', 1),
  ('a0000000-0000-4000-8000-00000000a106', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', null, '未使用', 2);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('a0000000-0000-4000-8000-00000000a102', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000a101', 'プロトコル', 0);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('a0000000-0000-4000-8000-00000000a103', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000a102', 'TCP', 0),
  ('a0000000-0000-4000-8000-00000000a104', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000a102', 'UDP', 1);

insert into public.questions (
  id, owner_id, subject_id, kind, stem, explanation,
  disabled_at, disabled_reason, deleted_at, created_at, updated_at
)
select
  ('a0000000-0000-4000-8000-00000000b00' || n)::uuid,
  '11111111-1111-4111-8111-111111111111',
  'a0000000-0000-4000-8000-000000000001',
  'keyword',
  'E2E 出題テストの問題 ' || n,
  'E2E 出題テストの問題 ' || n || ' の解説',
  case when n = 4 then timestamptz '2026-01-02 00:00:00+00' end,
  case when n = 4 then 'E2E 用の無効化' end,
  case when n = 5 then timestamptz '2026-01-02 00:00:00+00' end,
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n),
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n)
from generate_series(1, 7) as n;

insert into public.choices (owner_id, question_id, position, body, explanation, is_correct)
select
  '11111111-1111-4111-8111-111111111111',
  ('a0000000-0000-4000-8000-00000000b00' || n)::uuid,
  p,
  '問題 ' || n || ' の選択肢 ' || (p + 1),
  '問題 ' || n || ' の選択肢 ' || (p + 1) || ' の解説',
  p = 1
from generate_series(1, 7) as n, generate_series(0, 3) as p;

insert into public.question_keywords (question_id, keyword_id, owner_id) values
  ('a0000000-0000-4000-8000-00000000b001', 'a0000000-0000-4000-8000-00000000a102', '11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-00000000b002', 'a0000000-0000-4000-8000-00000000a103', '11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-00000000b003', 'a0000000-0000-4000-8000-00000000a103', '11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-00000000b003', 'a0000000-0000-4000-8000-00000000a104', '11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-00000000b004', 'a0000000-0000-4000-8000-00000000a104', '11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-00000000b005', 'a0000000-0000-4000-8000-00000000a103', '11111111-1111-4111-8111-111111111111'),
  ('a0000000-0000-4000-8000-00000000b006', 'a0000000-0000-4000-8000-00000000a105', '11111111-1111-4111-8111-111111111111');

-- 大量データ: ルート 40 件 → 子 1,160 件
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order)
select
  ('b1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  'b0000000-0000-4000-8000-000000000001',
  null,
  'R' || lpad(n::text, 3, '0'),
  n - 1
from generate_series(1, 40) as n;

insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order)
select
  ('b1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  'b0000000-0000-4000-8000-000000000001',
  ('b1000000-0000-4000-8000-' || lpad((((n - 41) % 40) + 1)::text, 12, '0'))::uuid,
  'C' || lpad(n::text, 4, '0'),
  (n - 41) / 40
from generate_series(41, 1200) as n;

insert into public.questions (id, owner_id, subject_id, kind, stem, explanation, created_at, updated_at)
select
  ('b2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  'b0000000-0000-4000-8000-000000000001',
  'keyword',
  'E2E 大量データの問題 ' || lpad(n::text, 4, '0'),
  'E2E 大量データの問題 ' || lpad(n::text, 4, '0') || ' の解説',
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n),
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n)
from generate_series(1, 1050) as n;

insert into public.choices (owner_id, question_id, position, body, explanation, is_correct)
select
  '11111111-1111-4111-8111-111111111111',
  ('b2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  p,
  '選択肢 ' || (p + 1),
  '選択肢 ' || (p + 1) || ' の解説',
  p = 1
from generate_series(1, 1050) as n, generate_series(0, 3) as p;

insert into public.question_keywords (question_id, keyword_id, owner_id)
select
  ('b2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('b1000000-0000-4000-8000-' || lpad((((n - 1) % 1160) + 41)::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111'
from generate_series(1, 1050) as n;
-- ============================================================
-- quiz-session ここまで
-- ============================================================

-- ============================================================
-- question-exchange（ローカル E2E 用。本番には適用しない）
-- ============================================================
-- 所有者: e2e@example.com（11111111-1111-4111-8111-111111111111）
--
-- 科目「E2E 交換テスト」（c0000000-0000-4000-8000-000000000001）
--   キーワード（ID は c0000000-0000-4000-8000-00000000c1xx）
--     c101 アルゴリズム（ルート）
--       c102 ソート（途中ノード）
--         c103 クイックソート（葉）
--         c104 マージソート（葉）
--     c105 データ構造（ルート・葉）
--   問題（ID は c0000000-0000-4000-8000-00000000d00n、選択肢は各 4 個で正解は position 1）
--     d001 出題対象: ソート（途中ノード）  解答 4 回・正解 4（正答率 100%）  フラグ defective（未解消）
--     d002 出題対象: クイックソート        解答 4 回・正解 1（正答率 25%）   フラグ comment（未解消）
--     d003 出題対象: マージソート          解答 2 回・正解 1（正答率 50%）   フラグ guessable（解消済み）
--     d004 出題対象: データ構造            解答 1 回・正解 0（正答率 0%）    フラグなし
--     d005 無効:     クイックソート        解答なし                           フラグ low_value（未解消）
--     d006 削除:     マージソート          解答なし                           フラグなし
--     d007 出題対象: クイックソート        解答なし（未解答）                 フラグなし
--     d008 出題対象: キーワードなし        解答なし                           フラグなし
--   出題対象の件数: 科目全体 6、アルゴリズム 4、ソート 4、クイックソート 2、マージソート 1、データ構造 1
--   未解消のフラグ: d001・d002・d005（無効の問題）、解消済み: d003
--
-- 科目「E2E 交換大量データ」（c0000000-0000-4000-8000-000000000002）
--   キーワード 1 件（c1000000-0000-4000-8000-000000000001「全体」）
--   問題 1,200 件（すべて出題対象・キーワード「全体」に紐づく）、選択肢 4,800 件（正解は position 1）
--     ID は c2000000-0000-4000-8000-{n を 12 桁}
--
-- answers・question_flags は直接書き込みを拒否するトリガーがあるため、
-- この節だけトランザクション内で quiz.write_via_rpc を有効にする（ローカル seed 専用）。
-- 他の E2E の後片付けは名前の接頭辞で行うため、これらの行は削除されない。
-- ============================================================
begin;

insert into public.subjects (id, owner_id, name, created_at, updated_at) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'E2E 交換テスト', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'E2E 交換大量データ', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00');

-- 親を先に挿入する
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('c0000000-0000-4000-8000-00000000c101', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', null, 'アルゴリズム', 0),
  ('c0000000-0000-4000-8000-00000000c105', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', null, 'データ構造', 1);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('c0000000-0000-4000-8000-00000000c102', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000c101', 'ソート', 0);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('c0000000-0000-4000-8000-00000000c103', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000c102', 'クイックソート', 0),
  ('c0000000-0000-4000-8000-00000000c104', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000c102', 'マージソート', 1);

insert into public.questions (
  id, owner_id, subject_id, kind, stem, explanation,
  disabled_at, disabled_reason, deleted_at, created_at, updated_at
)
select
  ('c0000000-0000-4000-8000-00000000d00' || n)::uuid,
  '11111111-1111-4111-8111-111111111111',
  'c0000000-0000-4000-8000-000000000001',
  'keyword',
  'E2E 交換テストの問題 ' || n,
  'E2E 交換テストの問題 ' || n || ' の解説',
  case when n = 5 then timestamptz '2026-01-02 00:00:00+00' end,
  case when n = 5 then 'E2E 用の無効化' end,
  case when n = 6 then timestamptz '2026-01-02 00:00:00+00' end,
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n),
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n)
from generate_series(1, 8) as n;

insert into public.choices (owner_id, question_id, position, body, explanation, is_correct)
select
  '11111111-1111-4111-8111-111111111111',
  ('c0000000-0000-4000-8000-00000000d00' || n)::uuid,
  p,
  '交換問題 ' || n || ' の選択肢 ' || (p + 1),
  '交換問題 ' || n || ' の選択肢 ' || (p + 1) || ' の解説',
  p = 1
from generate_series(1, 8) as n, generate_series(0, 3) as p;

insert into public.question_keywords (question_id, keyword_id, owner_id) values
  ('c0000000-0000-4000-8000-00000000d001', 'c0000000-0000-4000-8000-00000000c102', '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-00000000d002', 'c0000000-0000-4000-8000-00000000c103', '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-00000000d003', 'c0000000-0000-4000-8000-00000000c104', '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-00000000d004', 'c0000000-0000-4000-8000-00000000c105', '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-00000000d005', 'c0000000-0000-4000-8000-00000000c103', '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-00000000d006', 'c0000000-0000-4000-8000-00000000c104', '11111111-1111-4111-8111-111111111111'),
  ('c0000000-0000-4000-8000-00000000d007', 'c0000000-0000-4000-8000-00000000c103', '11111111-1111-4111-8111-111111111111');

select set_config('quiz.write_via_rpc', 'on', true);

-- 解答履歴: (問題, 回数, 正解数)。正解は position 1、不正解は position 0 を選ぶ
insert into public.answers (owner_id, question_id, choice_id, answer_kind, is_correct, client_answer_id, answered_at)
select
  '11111111-1111-4111-8111-111111111111',
  h.qid,
  c.id,
  'normal',
  i <= h.correct,
  gen_random_uuid(),
  timestamptz '2026-01-03 00:00:00+00' + make_interval(mins => i)
from (values
  ('c0000000-0000-4000-8000-00000000d001'::uuid, 4, 4),
  ('c0000000-0000-4000-8000-00000000d002'::uuid, 4, 1),
  ('c0000000-0000-4000-8000-00000000d003'::uuid, 2, 1),
  ('c0000000-0000-4000-8000-00000000d004'::uuid, 1, 0)
) as h(qid, total, correct)
cross join lateral generate_series(1, h.total) as i
join public.choices c
  on c.question_id = h.qid and c.position = case when i <= h.correct then 1 else 0 end;

insert into public.question_flags (owner_id, question_id, flag, note, status, created_at, resolved_at) values
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000d001',
   'defective', null, 'open', '2026-01-04 00:00:00+00', null),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000d002',
   'comment', 'E2E 用のコメント', 'open', '2026-01-04 00:00:00+00', null),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000d003',
   'guessable', null, 'resolved', '2026-01-04 00:00:00+00', '2026-01-05 00:00:00+00'),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000d005',
   'low_value', null, 'open', '2026-01-04 00:00:00+00', null);

-- 大量データ: 1,200 問・選択肢 4,800 件
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000002', null, '全体', 0);

insert into public.questions (id, owner_id, subject_id, kind, stem, explanation, created_at, updated_at)
select
  ('c2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  'c0000000-0000-4000-8000-000000000002',
  'keyword',
  'E2E 交換大量データの問題 ' || lpad(n::text, 4, '0'),
  'E2E 交換大量データの問題 ' || lpad(n::text, 4, '0') || ' の解説',
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n),
  timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => n)
from generate_series(1, 1200) as n;

insert into public.choices (owner_id, question_id, position, body, explanation, is_correct)
select
  '11111111-1111-4111-8111-111111111111',
  ('c2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  p,
  '選択肢 ' || (p + 1),
  '選択肢 ' || (p + 1) || ' の解説',
  p = 1
from generate_series(1, 1200) as n, generate_series(0, 3) as p;

insert into public.question_keywords (question_id, keyword_id, owner_id)
select
  ('c2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111'
from generate_series(1, 1200) as n;

commit;
-- ============================================================
-- question-exchange ここまで
-- ============================================================

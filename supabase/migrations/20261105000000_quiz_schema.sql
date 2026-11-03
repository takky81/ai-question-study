-- quiz-session: 解答履歴・SRS 状態・問題フラグのテーブル、制約、index、RLS、直接書き込みの拒否
-- 集計ビューは 20261105000100_quiz_views.sql、関数・RPC は 20261105000200_quiz_functions.sql で定義する。

-- 内部用スキーマ（SRS 計算・フラグ解消・トリガー関数を置く。PostgREST には公開しない）
-- authenticated には usage だけを与える（SECURITY INVOKER の RPC から内部関数を呼ぶため）
create schema if not exists quiz_private;
revoke all on schema quiz_private from public;
revoke all on schema quiz_private from anon, authenticated;
grant usage on schema quiz_private to authenticated;

-- ============================================================
-- 複合型
-- ============================================================

-- SRS 状態（srs_next の入出力）
create type public.srs_input as (
  stability_days double precision,
  ease double precision,
  review_count integer,
  lapse_count integer
);

-- 出題候補（list_quiz_candidates の返り値）
create type public.quiz_candidate as (
  question_id uuid,
  created_at timestamptz,
  attempt_count integer,
  correct_count integer,
  correct_rate double precision,
  retention double precision,
  last_answered_at timestamptz
);

-- 解答結果（record_answer の返り値）
create type public.answer_result as (
  answer_id uuid,
  is_correct boolean,
  correct_choice_id uuid,
  attempt_count integer,
  correct_count integer,
  correct_rate double precision,
  retention double precision,
  last_answered_at timestamptz,
  already_recorded boolean
);

-- ============================================================
-- テーブル
-- ============================================================

-- 解答履歴（問題・選択肢は上流で物理削除されないため、on delete restrict で履歴を保持する）
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  choice_id uuid null references public.choices (id) on delete restrict,
  answer_kind text not null check (answer_kind in ('normal', 'guess', 'unknown')),
  is_correct boolean not null,
  client_answer_id uuid not null,
  answered_at timestamptz not null default now(),
  -- 冪等キー（同じ解答の再送で二重に記録しない）
  constraint answers_owner_client_answer_key unique (owner_id, client_answer_id),
  -- 「わからない」だけが選択肢なし
  constraint answers_choice_matches_kind check ((answer_kind = 'unknown') = (choice_id is null)),
  -- 「わからない」は常に不正解
  constraint answers_unknown_not_correct check (answer_kind <> 'unknown' or not is_correct)
);

create index answers_question_answered_idx on public.answers (question_id, answered_at);
create index answers_choice_idx on public.answers (choice_id);

-- 問題単位の SRS 状態（通常の解答・わからないで更新する）
create table public.srs_states (
  question_id uuid primary key references public.questions (id) on delete restrict,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  stability_days double precision not null check (stability_days > 0),
  ease double precision not null check (ease between 1.3 and 3.0),
  review_count integer not null check (review_count >= 1),
  lapse_count integer not null check (lapse_count >= 0),
  last_reviewed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- 問題フラグ（識別子の正本は steering の product.md）
create table public.question_flags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  flag text not null
    check (flag in ('guessable', 'low_value', 'needs_explanation', 'defective', 'comment')),
  note text null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  -- コメントだけが空白でない本文を持つ
  constraint question_flags_note_matches_flag
    check ((flag = 'comment') = (note is not null and length(btrim(note)) > 0)),
  -- 解消済みは解消日時を持つ
  constraint question_flags_resolved_at_matches_status
    check ((status = 'resolved') = (resolved_at is not null))
);

-- 未解消の同じフラグは問題ごとに1つ
create unique index question_flags_open_key
  on public.question_flags (question_id, flag)
  where status = 'open';
create index question_flags_question_status_idx on public.question_flags (question_id, status);

-- ============================================================
-- RLS（参照・書き込みとも所有者本人に限る）
-- ============================================================

alter table public.answers enable row level security;
alter table public.srs_states enable row level security;
alter table public.question_flags enable row level security;

create policy answers_owner on public.answers
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy srs_states_owner on public.srs_states
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy question_flags_owner on public.question_flags
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- RPC は SECURITY INVOKER のため、authenticated にテーブル権限を与える
-- （直接の書き込みは下のトリガーで拒否する）
revoke all on table public.answers, public.srs_states, public.question_flags from anon, public;
grant select, insert, update, delete
  on table public.answers, public.srs_states, public.question_flags
  to authenticated;

-- ============================================================
-- トリガー関数（quiz_private。呼び出し側の権限で実行する）
-- ============================================================

-- RPC 経由（トランザクション内で quiz.write_via_rpc = 'on'）でない書き込みを拒否する。
-- 解消済みのフラグは RPC 経由でも変更・削除できない。
-- GUC 名と値は learning-stats の seed も使う契約であり、変更時は seed も更新する。
create function quiz_private.guard_direct_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('quiz.write_via_rpc', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'direct_write_forbidden';
  end if;
  -- old.status は question_flags にしかないため、条件を入れ子にして評価順を固定する
  if tg_table_name = 'question_flags' and tg_op in ('UPDATE', 'DELETE') then
    if old.status = 'resolved' then
      raise exception using errcode = 'P0001', message = 'resolved_flag_immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function quiz_private.guard_direct_write() from public, anon, authenticated;

create trigger answers_guard_direct_write
  before insert or update or delete on public.answers
  for each row execute function quiz_private.guard_direct_write();

create trigger srs_states_guard_direct_write
  before insert or update or delete on public.srs_states
  for each row execute function quiz_private.guard_direct_write();

create trigger question_flags_guard_direct_write
  before insert or update or delete on public.question_flags
  for each row execute function quiz_private.guard_direct_write();

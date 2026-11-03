-- subject-catalog: カタログのテーブル、制約、RLS、トリガー、ビュー、index
-- RPC と部分木関数は 20261104000100_catalog_rpc.sql で定義する。

-- 部分一致検索の trigram index 用
create extension if not exists pg_trgm with schema extensions;

-- 内部用スキーマ（トリガー関数を置く。クライアントには usage を与えない）
create schema if not exists catalog_private;
revoke all on schema catalog_private from public;
revoke all on schema catalog_private from anon, authenticated;

-- ============================================================
-- テーブル
-- ============================================================

-- 科目（論理削除）
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

-- 有効な科目の中でだけ名前を一意にする
create unique index subjects_owner_name_active_key
  on public.subjects (owner_id, name)
  where deleted_at is null;

-- キーワード（物理削除。親の削除で部分木ごと消える）
create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  parent_id uuid null references public.keywords (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  sort_order int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 兄弟名の一意性（科目直下の parent_id null 同士も重複とみなす）
  constraint keywords_sibling_name_key unique nulls not distinct (subject_id, parent_id, name)
);

create index keywords_subject_parent_sort_idx
  on public.keywords (subject_id, parent_id, sort_order);
create index keywords_parent_idx on public.keywords (parent_id);

-- 問題（無効化・論理削除）
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  kind text not null check (kind in ('keyword', 'feature')),
  stem text not null check (length(btrim(stem)) > 0),
  explanation text not null check (length(btrim(explanation)) > 0),
  disabled_at timestamptz null,
  disabled_reason text null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 一覧（新しい順、同時刻は ID 順）
create index questions_list_idx
  on public.questions (subject_id, created_at desc, id desc)
  where deleted_at is null;
-- 部分一致検索
create index questions_stem_trgm_idx
  on public.questions using gin (stem extensions.gin_trgm_ops);
create index questions_explanation_trgm_idx
  on public.questions using gin (explanation extensions.gin_trgm_ops);

-- 選択肢（外された選択肢も行を残し removed_at を設定する）
create table public.choices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  position int not null,
  body text not null check (length(btrim(body)) > 0),
  explanation text not null check (length(btrim(explanation)) > 0),
  is_correct boolean not null default false,
  removed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 有効な選択肢の表示順の一意性
create unique index choices_question_position_active_key
  on public.choices (question_id, position)
  where removed_at is null;
-- 有効な選択肢の正解は最大1つ
create unique index choices_question_one_correct_key
  on public.choices (question_id)
  where is_correct and removed_at is null;
create index choices_body_trgm_idx
  on public.choices using gin (body extensions.gin_trgm_ops);

-- 問題とキーワードの紐づけ
create table public.question_keywords (
  question_id uuid not null references public.questions (id) on delete cascade,
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_id, keyword_id)
);

create index question_keywords_keyword_idx on public.question_keywords (keyword_id);

-- ============================================================
-- RLS（参照・書き込みとも所有者本人に限る）
-- ============================================================

alter table public.subjects enable row level security;
alter table public.keywords enable row level security;
alter table public.questions enable row level security;
alter table public.choices enable row level security;
alter table public.question_keywords enable row level security;

create policy subjects_owner on public.subjects
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy keywords_owner on public.keywords
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy questions_owner on public.questions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 選択肢は所有者本人であることに加え、書き込み先の問題も本人のものに限る
-- （他人の question_id を指定した挿入・付け替えで表示順や正解の一意性に干渉させない）
create policy choices_owner on public.choices
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.questions q
      where q.id = question_id
        and q.owner_id = (select auth.uid())
    )
  );

create policy question_keywords_owner on public.question_keywords
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ============================================================
-- トリガー関数（catalog_private。呼び出し側の権限で実行する）
-- ============================================================

-- updated_at の自動更新
create function catalog_private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- キーワードの親が同じ科目に属し、循環しないことを検査する
create function catalog_private.check_keyword_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent_subject uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception using errcode = 'P0001', message = 'keyword_cycle';
  end if;

  select k.subject_id into v_parent_subject
  from public.keywords k
  where k.id = new.parent_id;

  if v_parent_subject is distinct from new.subject_id then
    raise exception using errcode = 'P0001', message = 'keyword_subject_mismatch';
  end if;

  -- 新しい親の祖先に自分が含まれれば循環になる（union で既存データの循環でも停止する）
  if exists (
    with recursive ancestors (id, parent_id) as (
      select k.id, k.parent_id from public.keywords k where k.id = new.parent_id
      union
      select k.id, k.parent_id
      from public.keywords k
      join ancestors a on k.id = a.parent_id
    )
    select 1 from ancestors where ancestors.id = new.id
  ) then
    raise exception using errcode = 'P0001', message = 'keyword_cycle';
  end if;

  return new;
end;
$$;

-- sort_order が null のとき兄弟の末尾（最大値 + 1）を設定する
create function catalog_private.set_keyword_sort_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.sort_order is null then
    select coalesce(max(k.sort_order) + 1, 0) into new.sort_order
    from public.keywords k
    where k.subject_id = new.subject_id
      and k.parent_id is not distinct from new.parent_id;
  end if;
  return new;
end;
$$;

-- 紐づけ先のキーワードが問題と同じ科目であることを検査する
-- 呼び出し側の権限（RLS 下）で問題とキーワードを参照するため、他人の問題・キーワードは
-- 見えず、ここで拒否される（所有者の異なる紐づけの防止も兼ねる）
create function catalog_private.check_link_subject()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.questions q
    join public.keywords k on k.subject_id = q.subject_id
    where q.id = new.question_id
      and k.id = new.keyword_id
  ) then
    raise exception using errcode = 'P0001', message = 'keyword_subject_mismatch';
  end if;
  return new;
end;
$$;

-- コミット時に、有効な選択肢の正解がちょうど1つであることを検査する（遅延制約トリガー）
create function catalog_private.check_one_correct()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question_id uuid;
begin
  if tg_op = 'DELETE' then
    v_question_id := old.question_id;
  else
    v_question_id := new.question_id;
  end if;

  -- 問題ごと削除された場合（cascade）は検査しない
  if not exists (select 1 from public.questions q where q.id = v_question_id) then
    return null;
  end if;

  if (
    select count(*)
    from public.choices c
    where c.question_id = v_question_id
      and c.is_correct
      and c.removed_at is null
  ) <> 1 then
    raise exception using errcode = 'P0001', message = 'one_correct_required';
  end if;

  return null;
end;
$$;

-- トリガー関数はクライアントから実行させない
revoke all on function catalog_private.touch_updated_at() from public, anon, authenticated;
revoke all on function catalog_private.check_keyword_parent() from public, anon, authenticated;
revoke all on function catalog_private.set_keyword_sort_order() from public, anon, authenticated;
revoke all on function catalog_private.check_link_subject() from public, anon, authenticated;
revoke all on function catalog_private.check_one_correct() from public, anon, authenticated;

-- ============================================================
-- トリガー
-- ============================================================

create trigger subjects_touch_updated_at
  before update on public.subjects
  for each row execute function catalog_private.touch_updated_at();

create trigger keywords_touch_updated_at
  before update on public.keywords
  for each row execute function catalog_private.touch_updated_at();

create trigger questions_touch_updated_at
  before update on public.questions
  for each row execute function catalog_private.touch_updated_at();

create trigger choices_touch_updated_at
  before update on public.choices
  for each row execute function catalog_private.touch_updated_at();

-- 名前順で発火するため、末尾設定（a_）を親の検査（b_）より先に行う
create trigger a_keywords_set_sort_order
  before insert on public.keywords
  for each row execute function catalog_private.set_keyword_sort_order();

create trigger b_check_keyword_parent
  before insert or update of parent_id, subject_id on public.keywords
  for each row execute function catalog_private.check_keyword_parent();

create trigger check_link_subject
  before insert or update on public.question_keywords
  for each row execute function catalog_private.check_link_subject();

create constraint trigger check_one_correct
  after insert or update or delete on public.choices
  deferrable initially deferred
  for each row execute function catalog_private.check_one_correct();

-- ============================================================
-- ビュー
-- ============================================================

-- 出題・集計対象の唯一の定義（無効・削除でない問題）
create view public.servable_questions
with (security_invoker = true)
as
select q.*
from public.questions q
where q.disabled_at is null
  and q.deleted_at is null;

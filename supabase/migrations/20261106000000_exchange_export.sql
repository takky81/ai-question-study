-- question-exchange: 出力対象の絞り込みと出力用の RPC
-- すべて呼び出し元の権限で評価し（security invoker）、RLS により所有者の行だけを返す。
-- exchange_private は PostgREST の公開スキーマに加えない（クライアントから直接呼べない）。
-- 部分木の ID 一覧はクライアントに返さず、DB 側で絞り込む。

-- ============================================================
-- 内部スキーマ
-- ============================================================
create schema if not exists exchange_private;
revoke all on schema exchange_private from public;
revoke all on schema exchange_private from anon, authenticated;
grant usage on schema exchange_private to authenticated;

-- ============================================================
-- 出力対象の問題 ID
-- ============================================================
-- p_filter（すべて省略可。null は条件なし。条件はすべて AND で結合する）:
--   flag: 'all'（既定）| 'any'（未解消のフラグあり）| 'none'（未解消のフラグなし）| 'types'（flagTypes のいずれか）
--   flagTypes: text[]（flag = 'types' のときの未解消のフラグの種類）
--   correctRateMin / correctRateMax: 0〜1（正答率が null の問題は除外）
--   attemptMin / attemptMax: 出題数（集計なしは 0）
--   attempted: true は出題数 > 0、false は出題数 = 0
--   includeDisabled: 真のときだけ無効の問題を含める（既定は含めない）
-- 削除済みの問題は常に除く。
create function exchange_private.export_target_ids(p_subject_id uuid, p_keyword_id uuid, p_filter jsonb)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select q.id
  from public.questions q
  left join public.question_stats s on s.question_id = q.id
  where q.subject_id = p_subject_id
    and q.deleted_at is null
    and (coalesce((p_filter ->> 'includeDisabled')::boolean, false) or q.disabled_at is null)
    and (
      p_keyword_id is null
      or exists (
        select 1
        from public.question_keywords qk
        where qk.question_id = q.id
          and qk.keyword_id in (select st.id from public.keyword_subtree_ids(p_keyword_id) as st (id))
      )
    )
    and (
      coalesce(p_filter ->> 'flag', 'all') = 'all'
      or (p_filter ->> 'flag' = 'any' and exists (
        select 1 from public.question_flags qf
        where qf.question_id = q.id and qf.status = 'open'))
      or (p_filter ->> 'flag' = 'none' and not exists (
        select 1 from public.question_flags qf
        where qf.question_id = q.id and qf.status = 'open'))
      or (p_filter ->> 'flag' = 'types' and exists (
        select 1 from public.question_flags qf
        where qf.question_id = q.id
          and qf.status = 'open'
          and qf.flag in (
            select jsonb_array_elements_text(coalesce(p_filter -> 'flagTypes', '[]'::jsonb))
          )))
    )
    and (p_filter ->> 'correctRateMin' is null
      or s.correct_rate >= (p_filter ->> 'correctRateMin')::double precision)
    and (p_filter ->> 'correctRateMax' is null
      or s.correct_rate <= (p_filter ->> 'correctRateMax')::double precision)
    and (p_filter ->> 'attemptMin' is null
      or coalesce(s.attempt_count, 0) >= (p_filter ->> 'attemptMin')::integer)
    and (p_filter ->> 'attemptMax' is null
      or coalesce(s.attempt_count, 0) <= (p_filter ->> 'attemptMax')::integer)
    and (p_filter ->> 'attempted' is null
      or ((p_filter ->> 'attempted')::boolean = (coalesce(s.attempt_count, 0) > 0)));
$$;

revoke all on function exchange_private.export_target_ids(uuid, uuid, jsonb) from public, anon;
grant execute on function exchange_private.export_target_ids(uuid, uuid, jsonb) to authenticated;

-- ============================================================
-- 行型
-- ============================================================
create type public.export_question_row as (
  id uuid,
  kind text,
  stem text,
  explanation text,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  keyword_ids uuid[],
  attempt_count integer,
  correct_count integer,
  correct_rate double precision,
  retention double precision
);

create type public.export_choice_row as (
  question_id uuid,
  id uuid,
  position integer,
  body text,
  explanation text,
  is_correct boolean
);

create type public.export_flag_row as (
  id uuid,
  question_id uuid,
  flag text,
  note text,
  created_at timestamptz
);

-- ============================================================
-- 出力 RPC（ページ分割で取得するため、一意で安定した順序で返す）
-- ============================================================

-- 問題（紐づけと問題ごとの集計値を含む）。無効の問題は集計の行がないため null・0。順序: created_at, id
create function public.export_questions(p_subject_id uuid, p_keyword_id uuid, p_filter jsonb)
returns setof public.export_question_row
language sql
stable
security invoker
set search_path = ''
as $$
  select
    q.id,
    q.kind,
    q.stem,
    q.explanation,
    q.disabled_at,
    q.disabled_reason,
    q.created_at,
    q.updated_at,
    coalesce(
      (select array_agg(qk.keyword_id order by qk.keyword_id)
       from public.question_keywords qk
       where qk.question_id = q.id),
      '{}'::uuid[]
    ) as keyword_ids,
    coalesce(s.attempt_count, 0)::integer as attempt_count,
    coalesce(s.correct_count, 0)::integer as correct_count,
    s.correct_rate,
    s.retention
  from public.questions q
  left join public.question_stats s on s.question_id = q.id
  where q.id in (select t.id from exchange_private.export_target_ids(p_subject_id, p_keyword_id, p_filter) as t (id))
  order by q.created_at, q.id;
$$;

-- 有効な選択肢（外された選択肢を除く）。順序: question_id, position
create function public.export_choices(p_subject_id uuid, p_keyword_id uuid, p_filter jsonb)
returns setof public.export_choice_row
language sql
stable
security invoker
set search_path = ''
as $$
  select c.question_id, c.id, c.position, c.body, c.explanation, c.is_correct
  from public.choices c
  where c.removed_at is null
    and c.question_id in (select t.id from exchange_private.export_target_ids(p_subject_id, p_keyword_id, p_filter) as t (id))
  order by c.question_id, c.position;
$$;

-- 未解消のフラグ。順序: question_id, created_at, id
create function public.export_flags(p_subject_id uuid, p_keyword_id uuid, p_filter jsonb)
returns setof public.export_flag_row
language sql
stable
security invoker
set search_path = ''
as $$
  select f.id, f.question_id, f.flag, f.note, f.created_at
  from public.question_flags f
  where f.status = 'open'
    and f.question_id in (select t.id from exchange_private.export_target_ids(p_subject_id, p_keyword_id, p_filter) as t (id))
  order by f.question_id, f.created_at, f.id;
$$;

revoke all on function public.export_questions(uuid, uuid, jsonb) from public, anon;
revoke all on function public.export_choices(uuid, uuid, jsonb) from public, anon;
revoke all on function public.export_flags(uuid, uuid, jsonb) from public, anon;
grant execute on function public.export_questions(uuid, uuid, jsonb) to authenticated;
grant execute on function public.export_choices(uuid, uuid, jsonb) to authenticated;
grant execute on function public.export_flags(uuid, uuid, jsonb) to authenticated;

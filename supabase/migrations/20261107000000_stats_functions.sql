-- learning-stats: 出題セッションの集計ビューを区間に振り分ける関数
-- 上流（catalog、quiz）のテーブル・ビュー・関数は読むだけで変更しない。

-- ============================================================
-- 内部用スキーマ（API の公開スキーマには含めない）
-- ============================================================
create schema if not exists stats_private;
revoke all on schema stats_private from public;
revoke all on schema stats_private from anon;
grant usage on schema stats_private to authenticated;

-- ============================================================
-- 区間への振り分け（不変関数）
-- ============================================================

-- 正答率の区間番号: 出題数 0 は -1（未出題）、k（0〜8）は k*10% 以上 (k+1)*10% 未満、9 は 90% 以上 100% 以下。
-- 浮動小数の正答率ではなく整数から求め、境界での丸め誤差を避ける。
create function stats_private.rate_bin(p_correct integer, p_attempt integer)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_attempt <= 0 then -1
    else least(9, (p_correct * 10) / p_attempt)
  end;
$$;

-- 出題回数の区間番号: 0 回は 0、k（1 以上）は 2^(k-1) 回以上 2^k - 1 回以下。
create function stats_private.count_bin(p_attempt integer)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_attempt <= 0 then 0
    else pg_catalog.width_bucket(
      p_attempt,
      array(select (2::bigint ^ g)::integer from pg_catalog.generate_series(0, 30) as g)
    )
  end;
$$;

-- ============================================================
-- 対象の定義
-- ============================================================

-- 科目（と任意のキーワード範囲）の設問またはキーワードの集計行を返す。
-- question: question_stats（出題対象の問題のみ）。範囲指定時は部分木のキーワードに紐づく問題。question_count は null。
-- keyword: keyword_stats のうち配下を含めて問題が紐づくもの。範囲指定時は部分木のキーワード。
-- その他の p_target は0行（検査は呼び出し側の RPC が行う）。
create function stats_private.target_items(p_target text, p_subject_id uuid, p_keyword_id uuid)
returns table (
  item_id uuid,
  attempt_count integer,
  correct_count integer,
  correct_rate double precision,
  question_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select qs.question_id, qs.attempt_count, qs.correct_count, qs.correct_rate, null::integer
  from public.question_stats qs
  where p_target = 'question'
    and qs.subject_id = p_subject_id
    and (
      p_keyword_id is null
      or exists (
        select 1
        from public.question_keywords qk
        where qk.question_id = qs.question_id
          and qk.keyword_id in (select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id))
      )
    )
  union all
  select ks.keyword_id, ks.attempt_count, ks.correct_count, ks.correct_rate, ks.question_count
  from public.keyword_stats ks
  where p_target = 'keyword'
    and ks.subject_id = p_subject_id
    and ks.question_count > 0
    and (
      p_keyword_id is null
      or ks.keyword_id in (select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id))
    );
$$;

-- ============================================================
-- 権限（RPC から呼ぶため authenticated にだけ実行権限を与える）
-- ============================================================
revoke all on function stats_private.rate_bin(integer, integer) from public, anon;
revoke all on function stats_private.count_bin(integer) from public, anon;
revoke all on function stats_private.target_items(text, uuid, uuid) from public, anon;
grant execute on function stats_private.rate_bin(integer, integer) to authenticated;
grant execute on function stats_private.count_bin(integer) to authenticated;
grant execute on function stats_private.target_items(text, uuid, uuid) to authenticated;

-- ============================================================
-- 結果行の複合型
-- ============================================================
create type public.stats_histogram_row as (
  target text,
  metric text,
  bin integer,
  item_count integer
);

create type public.stats_bin_item as (
  item_id uuid,
  attempt_count integer,
  correct_count integer,
  correct_rate double precision,
  question_count integer,
  stem text
);

-- ============================================================
-- 区間ごとの件数（RPC）
-- ============================================================

-- 設問・キーワードそれぞれについて、正答率は -1〜9 の全区間、出題回数は 0 から最大の区間までの全区間を
-- 0 件の区間も含めて返す。
create function public.stats_histograms(p_subject_id uuid, p_keyword_id uuid)
returns setof public.stats_histogram_row
language sql
stable
security invoker
set search_path = ''
as $$
  with targets (target) as (
    values ('question'::text), ('keyword'::text)
  ),
  items as (
    select
      t.target,
      stats_private.rate_bin(i.correct_count, i.attempt_count) as rate_bin,
      stats_private.count_bin(i.attempt_count) as count_bin
    from targets t
    cross join lateral stats_private.target_items(t.target, p_subject_id, p_keyword_id) as i
  ),
  bins (target, metric, bin) as (
    select t.target, 'correct_rate'::text, b
    from targets t
    cross join pg_catalog.generate_series(-1, 9) as b
    union all
    select t.target, 'attempt_count'::text, b
    from targets t
    cross join lateral pg_catalog.generate_series(
      0,
      coalesce((select max(it.count_bin) from items it where it.target = t.target), 0)
    ) as b
  )
  select
    bn.target,
    bn.metric,
    bn.bin,
    (
      select count(*)::integer
      from items it
      where it.target = bn.target
        and (case when bn.metric = 'correct_rate' then it.rate_bin else it.count_bin end) = bn.bin
    )
  from bins bn
  order by bn.target, bn.metric, bn.bin;
$$;

-- ============================================================
-- 区間内の一覧（RPC）
-- ============================================================

-- 件数と同じ target_items と区間関数で振り分け、指定区間の行を item_id 順に返す。設問には問題文を付ける。
create function public.stats_bin_items(
  p_target text,
  p_metric text,
  p_bin integer,
  p_subject_id uuid,
  p_keyword_id uuid
)
returns setof public.stats_bin_item
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_target is null or p_target not in ('question', 'keyword') then
    raise exception using errcode = 'P0001', message = 'invalid_stats_target';
  end if;
  if p_metric is null or p_metric not in ('correct_rate', 'attempt_count') then
    raise exception using errcode = 'P0001', message = 'invalid_stats_metric';
  end if;

  return query
  select
    i.item_id,
    i.attempt_count,
    i.correct_count,
    i.correct_rate,
    i.question_count,
    sq.stem
  from stats_private.target_items(p_target, p_subject_id, p_keyword_id) as i
  left join public.servable_questions sq
    on p_target = 'question'
    and sq.id = i.item_id
  where (
    case
      when p_metric = 'correct_rate' then stats_private.rate_bin(i.correct_count, i.attempt_count)
      else stats_private.count_bin(i.attempt_count)
    end
  ) = p_bin
  order by i.item_id;
end;
$$;

revoke all on function public.stats_histograms(uuid, uuid) from public, anon;
revoke all on function public.stats_bin_items(text, text, integer, uuid, uuid) from public, anon;
grant execute on function public.stats_histograms(uuid, uuid) to authenticated;
grant execute on function public.stats_bin_items(text, text, integer, uuid, uuid) to authenticated;

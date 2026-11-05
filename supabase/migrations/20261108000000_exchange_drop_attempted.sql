-- question-exchange: 出力対象の絞り込みから「出題の有無」（attempted）の条件を外す
-- 2026-11-05 の要件 1.6 の変更による。シグネチャは変えずに本体だけを置き換える。
-- p_filter に attempted が含まれていても無視する（出題数の条件は attemptMin / attemptMax で指定する）。

-- ============================================================
-- 出力対象の問題 ID
-- ============================================================
-- p_filter（すべて省略可。null は条件なし。条件はすべて AND で結合する）:
--   flag: 'all'（既定）| 'any'（未解消のフラグあり）| 'none'（未解消のフラグなし）| 'types'（flagTypes のいずれか）
--   flagTypes: text[]（flag = 'types' のときの未解消のフラグの種類）
--   correctRateMin / correctRateMax: 0〜1（正答率が null の問題は除外）
--   attemptMin / attemptMax: 出題数（集計なしは 0）
--   includeDisabled: 真のときだけ無効の問題を含める（既定は含めない）
-- 削除済みの問題は常に除く。
create or replace function exchange_private.export_target_ids(p_subject_id uuid, p_keyword_id uuid, p_filter jsonb)
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
      or coalesce(s.attempt_count, 0) <= (p_filter ->> 'attemptMax')::integer);
$$;

revoke all on function exchange_private.export_target_ids(uuid, uuid, jsonb) from public, anon;
grant execute on function exchange_private.export_target_ids(uuid, uuid, jsonb) to authenticated;

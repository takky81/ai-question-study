-- quiz-session: 問題ごと・キーワードごとの集計ビューと権限
-- 呼び出し元の権限で評価し（security_invoker）、基になるテーブルの RLS により所有者の行だけを返す。
-- quiz_functions（20261105000200）より前に適用されるため、このファイルの関数には依存しない。
-- 列名・型・意味（retention、correct_rate、除外条件）は下流（learning-stats、question-exchange）との契約。

-- ============================================================
-- question_stats: 出題対象の問題ごとの集計と定着率
-- ============================================================
-- attempt_count: answers の全種類（normal、guess、unknown）の件数
-- correct_count: is_correct が真の件数（unknown は常に誤答）
-- correct_rate: 出題数 0 は null
-- review_count: SRS に反映した回数（状態なしは 0）
-- retention: 忘却曲線 0.9^(経過日数 / 安定度)。SRS 状態なしは null。参照時刻で変わり、保存しない
create view public.question_stats
with (security_invoker = true)
as
select
  q.id as question_id,
  q.subject_id,
  coalesce(a.attempt_count, 0) as attempt_count,
  coalesce(a.correct_count, 0) as correct_count,
  a.correct_count::double precision / nullif(a.attempt_count, 0) as correct_rate,
  a.last_answered_at,
  coalesce(s.review_count, 0) as review_count,
  power(
    0.9::double precision,
    greatest(0::double precision, extract(epoch from (now() - s.last_reviewed_at))::double precision / 86400.0)
      / s.stability_days
  ) as retention
from public.servable_questions q
left join lateral (
  select
    count(*)::integer as attempt_count,
    (count(*) filter (where ans.is_correct))::integer as correct_count,
    max(ans.answered_at) as last_answered_at
  from public.answers ans
  where ans.question_id = q.id
) a on true
left join public.srs_states s on s.question_id = q.id;

-- ============================================================
-- keyword_stats: キーワードごとの集計（部分木に紐づく出題対象の問題を重複なく数える）
-- ============================================================
create view public.keyword_stats
with (security_invoker = true)
as
select
  k.id as keyword_id,
  k.subject_id,
  coalesce(t.question_count, 0) as question_count,
  coalesce(t.attempt_count, 0) as attempt_count,
  coalesce(t.correct_count, 0) as correct_count,
  t.correct_count::double precision / nullif(t.attempt_count, 0) as correct_rate
from public.keywords k
left join lateral (
  select
    count(*)::integer as question_count,
    sum(qs.attempt_count)::integer as attempt_count,
    sum(qs.correct_count)::integer as correct_count
  from (
    select distinct qk.question_id
    from public.question_keywords qk
    where qk.keyword_id in (select s.id from public.keyword_subtree_ids(k.id) as s (id))
  ) d
  join public.question_stats qs on qs.question_id = d.question_id
) t on true;

-- ============================================================
-- 権限（認証済みロールの参照のみ）
-- ============================================================
revoke all on table public.question_stats, public.keyword_stats from public, anon, authenticated;
grant select on table public.question_stats, public.keyword_stats to authenticated;

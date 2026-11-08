-- 「？」エリアでの解答で guessable を付けるのを正解のときだけにする（quiz-session 要件 4.4、7.7 の変更）。
-- record_answer を置き換える。それ以外の処理は 20261105000200_quiz_functions.sql と同じ。

-- 解答の記録: 冪等キーの確認、出題対象かの確認、DB 側での正誤判定、履歴の挿入、
-- SRS の更新（normal・unknown。行ロック付き）、guess での guessable の付与を1トランザクションで行い、
-- 更新後の成績と正解の選択肢を返す。クライアントは正誤を送らない。
create or replace function public.record_answer(
  p_client_answer_id uuid,
  p_question_id uuid,
  p_choice_id uuid,
  p_kind text
)
returns public.answer_result
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_result public.answer_result;
  v_is_correct boolean;
  v_answer_id uuid;
  v_grade text;
  v_state public.srs_input;
  v_last_reviewed timestamptz;
  v_next public.srs_input;
  v_found boolean;
begin
  -- guard_direct_write を通すための許可（トランザクション内のみ有効）
  perform set_config('quiz.write_via_rpc', 'on', true);

  -- 1. 冪等キーの既存確認（記録済みなら何も変更せずに返す）
  if exists (
    select 1 from public.answers a
    where a.owner_id = (select auth.uid()) and a.client_answer_id = p_client_answer_id
  ) then
    return quiz_private.existing_answer_result(p_client_answer_id);
  end if;

  if p_kind is null or p_kind not in ('normal', 'guess', 'unknown') then
    raise exception using errcode = 'P0001', message = 'invalid_answer_kind';
  end if;

  -- 2. 出題対象の確認（RLS により所有者の問題だけが見える）
  if not exists (select 1 from public.servable_questions q where q.id = p_question_id) then
    raise exception using errcode = 'P0001', message = 'question_not_servable';
  end if;

  -- 3. DB 側での正誤判定
  if p_kind = 'unknown' then
    if p_choice_id is not null then
      raise exception using errcode = 'P0001', message = 'choice_not_in_question';
    end if;
    v_is_correct := false;
  else
    select c.is_correct into v_is_correct
    from public.choices c
    where c.id = p_choice_id and c.question_id = p_question_id and c.removed_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'choice_not_in_question';
    end if;
  end if;

  -- 4. 履歴の挿入（同じ冪等キーの同時実行による一意違反は既存結果として返す）
  begin
    insert into public.answers (question_id, choice_id, answer_kind, is_correct, client_answer_id, answered_at)
    values (p_question_id, p_choice_id, p_kind, v_is_correct, p_client_answer_id, now())
    returning id into v_answer_id;
  exception when unique_violation then
    return quiz_private.existing_answer_result(p_client_answer_id);
  end;

  if p_kind <> 'guess' then
    -- 5. SRS の更新（通常: good／again、わからない: blackout）。行ロックで同時更新を直列化する
    v_grade := case when p_kind = 'unknown' then 'blackout' when v_is_correct then 'good' else 'again' end;
    select s.stability_days, s.ease, s.review_count, s.lapse_count, s.last_reviewed_at
    into v_state.stability_days, v_state.ease, v_state.review_count, v_state.lapse_count, v_last_reviewed
    from public.srs_states s
    where s.question_id = p_question_id
    for update;
    v_found := found;

    v_next := quiz_private.srs_next(
      case when v_found then v_state else null end,
      v_grade,
      case when v_found
        then greatest(0, extract(epoch from (now() - v_last_reviewed))::double precision / 86400.0)
        else 0 end
    );

    insert into public.srs_states
      (question_id, stability_days, ease, review_count, lapse_count, last_reviewed_at, updated_at)
    values
      (p_question_id, v_next.stability_days, v_next.ease, v_next.review_count, v_next.lapse_count, now(), now())
    on conflict (question_id) do update set
      stability_days = excluded.stability_days,
      ease = excluded.ease,
      review_count = excluded.review_count,
      lapse_count = excluded.lapse_count,
      last_reviewed_at = excluded.last_reviewed_at,
      updated_at = excluded.updated_at;
  else
    -- 6. 「？」エリアでの解答は SRS を変えない。正解した場合に限り guessable を未解消で1件だけ付与する
    if v_is_correct then
      insert into public.question_flags (question_id, flag, status)
      values (p_question_id, 'guessable', 'open')
      on conflict (question_id, flag) where status = 'open' do nothing;
    end if;
  end if;

  -- 7. 更新後の成績と正解の選択肢
  select
    v_answer_id,
    v_is_correct,
    (select c.id from public.choices c
      where c.question_id = p_question_id and c.is_correct and c.removed_at is null
      order by c.position, c.id limit 1),
    qs.attempt_count,
    qs.correct_count,
    qs.correct_rate,
    qs.retention,
    qs.last_answered_at,
    false
  into v_result
  from public.question_stats qs
  where qs.question_id = p_question_id;

  return v_result;
end;
$$;

revoke all on function public.record_answer(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.record_answer(uuid, uuid, uuid, text) to authenticated;

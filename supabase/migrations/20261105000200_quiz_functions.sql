-- quiz-session: SRS の更新計算、フラグの解消、解答の記録・フラグの保存・出題候補の取得の RPC
-- すべて呼び出し側の権限（RLS 下）で実行し、search_path を空にしてスキーマ修飾する。

-- ============================================================
-- 内部関数（quiz_private。PostgREST には公開しない）
-- ============================================================

-- SRS の次の状態を、現在の状態・評価・経過日数だけから計算する（不変関数）。
-- 状態が null（初回）のときは stability_days = null、ease = 2.5、回数 0 とみなす。
-- 評価: good（正解）／again（誤答）／blackout（わからない）。それ以外は invalid_grade。
-- SQL 関数では例外を出せないため plpgsql で書く（副作用はなく immutable）。
create function quiz_private.srs_next(
  p_state public.srs_input,
  p_grade text,
  p_elapsed_days double precision
)
returns public.srs_input
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_stability double precision := p_state.stability_days;
  v_ease double precision := coalesce(p_state.ease, 2.5);
  v_reviews integer := coalesce(p_state.review_count, 0);
  v_lapses integer := coalesce(p_state.lapse_count, 0);
  v_result public.srs_input;
begin
  if p_grade = 'good' then
    v_result.stability_days := case
      when v_stability is null then 1.0
      when p_elapsed_days >= v_stability * 0.5 then v_stability * v_ease
      else v_stability
    end;
    v_result.ease := least(3.0, v_ease + 0.05);
    v_result.lapse_count := v_lapses;
  elsif p_grade = 'again' then
    v_result.stability_days := greatest(0.2, coalesce(v_stability, 0.4) * 0.5);
    v_result.ease := greatest(1.3, v_ease - 0.2);
    v_result.lapse_count := v_lapses + 1;
  elsif p_grade = 'blackout' then
    v_result.stability_days := 0.2;
    v_result.ease := greatest(1.3, v_ease - 0.3);
    v_result.lapse_count := v_lapses + 1;
  else
    raise exception using errcode = 'P0001', message = 'invalid_grade';
  end if;
  v_result.review_count := v_reviews + 1;
  return v_result;
end;
$$;

revoke all on function quiz_private.srs_next(public.srs_input, text, double precision) from public, anon;
grant execute on function quiz_private.srs_next(public.srs_input, text, double precision) to authenticated;

-- 指定した問題の未解消フラグを解消済みにし、解消した件数を返す。
-- 取込 RPC（SECURITY INVOKER）の内部からだけ呼ぶ。呼び出し元のトランザクションに参加するため、
-- 取込が失敗すればロールバックされる。RLS により呼び出し元の所有者の行だけが対象になる。
create function quiz_private.resolve_question_flags(p_question_ids uuid[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- guard_direct_write を通すための許可（トランザクション内のみ有効）
  perform set_config('quiz.write_via_rpc', 'on', true);

  update public.question_flags
  set status = 'resolved', resolved_at = now()
  where question_id = any(p_question_ids)
    and status = 'open';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function quiz_private.resolve_question_flags(uuid[]) from public, anon;
grant execute on function quiz_private.resolve_question_flags(uuid[]) to authenticated;

-- 記録済みの解答（呼び出し元の所有者と冪等キーで特定）の結果を組み立てる。record_answer の内部用。
-- 返り値の is_correct は記録時の判定、成績は現在の question_stats の値。
create function quiz_private.existing_answer_result(p_client_answer_id uuid)
returns public.answer_result
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id,
    a.is_correct,
    (select c.id from public.choices c
      where c.question_id = a.question_id and c.is_correct and c.removed_at is null
      order by c.position, c.id limit 1),
    coalesce(qs.attempt_count, 0),
    coalesce(qs.correct_count, 0),
    qs.correct_rate,
    qs.retention,
    qs.last_answered_at,
    true
  from public.answers a
  left join public.question_stats qs on qs.question_id = a.question_id
  where a.owner_id = (select auth.uid())
    and a.client_answer_id = p_client_answer_id;
$$;

revoke all on function quiz_private.existing_answer_result(uuid) from public, anon;
grant execute on function quiz_private.existing_answer_result(uuid) to authenticated;

-- ============================================================
-- 公開 RPC（authenticated だけが実行できる）
-- ============================================================

-- 出題候補: 科目全体（p_keyword_id = null）またはキーワード部分木に紐づく出題対象の問題を、
-- 成績・定着率付きで作成日時・ID の一意な順序で返す。
create function public.list_quiz_candidates(p_subject_id uuid, p_keyword_id uuid)
returns setof public.quiz_candidate
language sql
stable
security invoker
set search_path = ''
as $$
  select
    q.id,
    q.created_at,
    qs.attempt_count,
    qs.correct_count,
    qs.correct_rate,
    qs.retention,
    qs.last_answered_at
  from public.servable_questions q
  join public.question_stats qs on qs.question_id = q.id
  where q.subject_id = p_subject_id
    and (p_keyword_id is null or exists (
      select 1 from public.question_keywords qk
      where qk.question_id = q.id
        and qk.keyword_id in (select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id))
    ))
  order by q.created_at, q.id;
$$;

-- 解答の記録: 冪等キーの確認、出題対象かの確認、DB 側での正誤判定、履歴の挿入、
-- SRS の更新（normal・unknown。行ロック付き）、guess での guessable の付与を1トランザクションで行い、
-- 更新後の成績と正解の選択肢を返す。クライアントは正誤を送らない。
create function public.record_answer(
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
    -- 6. 「？」エリアでの解答は SRS を変えず、guessable を未解消で1件だけ付与する
    insert into public.question_flags (question_id, flag, status)
    values (p_question_id, 'guessable', 'open')
    on conflict (question_id, flag) where status = 'open' do nothing;
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

-- フラグの保存: チェック型フラグを集合で置き換え、コメントは空白を除いて空なら削除し、
-- そうでなければ更新または挿入する。無効の問題にも保存できる（削除済み・他者の問題は question_not_found）。
create function public.save_question_flags(p_question_id uuid, p_flags text[], p_comment text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_flags text[] := coalesce(p_flags, array[]::text[]);
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  -- guard_direct_write を通すための許可（トランザクション内のみ有効）
  perform set_config('quiz.write_via_rpc', 'on', true);

  if not exists (
    select 1 from public.questions q where q.id = p_question_id and q.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'question_not_found';
  end if;

  if exists (
    select 1 from unnest(v_flags) as f (flag)
    where f.flag is null or f.flag not in ('guessable', 'low_value', 'needs_explanation', 'defective')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_flag';
  end if;

  delete from public.question_flags qf
  where qf.question_id = p_question_id
    and qf.status = 'open'
    and qf.flag <> 'comment'
    and not (qf.flag = any (v_flags));

  insert into public.question_flags (question_id, flag, status)
  select distinct p_question_id, f.flag, 'open' from unnest(v_flags) as f (flag)
  on conflict (question_id, flag) where status = 'open' do nothing;

  if v_comment is null then
    delete from public.question_flags qf
    where qf.question_id = p_question_id and qf.status = 'open' and qf.flag = 'comment';
  else
    insert into public.question_flags (question_id, flag, note, status)
    values (p_question_id, 'comment', v_comment, 'open')
    on conflict (question_id, flag) where status = 'open' do update set note = excluded.note;
  end if;
end;
$$;

revoke all on function public.list_quiz_candidates(uuid, uuid) from public, anon;
revoke all on function public.record_answer(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.save_question_flags(uuid, text[], text) from public, anon;
grant execute on function public.list_quiz_candidates(uuid, uuid) to authenticated;
grant execute on function public.record_answer(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_question_flags(uuid, text[], text) to authenticated;

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

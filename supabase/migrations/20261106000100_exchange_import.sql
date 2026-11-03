-- question-exchange: 取込を原子的に適用する RPC
-- 呼び出し元の権限で実行し（security invoker）、RLS により所有者の行だけを読み書きする。
-- 上流の RPC・内部関数は呼び出し元のトランザクションに参加するため、どの段階の例外でも全体がロールバックされる。
-- 注意: quiz_private.resolve_question_flags は quiz.write_via_rpc をトランザクションの終わりまで有効にする。
--       この関数はその呼び出しの後に quiz-session のテーブルへ書き込まない（最後に呼ぶ）。

-- p（キーはすべて camelCase。配列は省略可）:
--   subjectId: uuid
--   expected: { keywords: [{ id, updatedAt }], questions: [{ id, updatedAt }] }
--   keywordAdds: [{ tempKey, parentId, parentTempKey, name }]（親が先に来る順）
--   keywordRenames: [{ id, name }]
--   keywordMoves: [{ id, parentId, parentTempKey }]（両方 null は科目直下）
--   questionUpdates: [{ input }]（input は save_question の入力。input.id 必須）
--   questionCreates: [{ tempKey, input }]（tempKey は省略可。input.id は無視する）
--     input.keywordIds の要素は既存 ID または 'tmp:<tempKey>'
--   questionDisables: [{ id, reason }]
--   modifiedQuestionIds: uuid[]（内容が変わった問題。未解消のフラグを解消済みにする）
-- 返り値: { keywordIds: {tempKey: id}, questionIds: {tempKey: id}, counts: {...}, resolvedFlagCount }
create function public.apply_exchange_import(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_subject_id uuid := (p ->> 'subjectId')::uuid;
  v_kw_map jsonb := '{}'::jsonb;
  v_q_map jsonb := '{}'::jsonb;
  v_elem jsonb;
  v_input jsonb;
  v_parent uuid;
  v_new_id uuid;
  v_keyword_ids jsonb;
  v_ref text;
  v_stale boolean;
  v_added int := 0;
  v_renamed int := 0;
  v_moved int := 0;
  v_updated int := 0;
  v_created int := 0;
  v_disabled int := 0;
  v_resolved int;
begin
  -- 1. 科目と expected の行を固定し、プレビュー後の変更を検出する
  perform 1 from public.subjects s
  where s.id = v_subject_id and s.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'subject_not_found';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(p -> 'expected' -> 'keywords', '[]'::jsonb)) e
    left join lateral (
      select k.updated_at, k.subject_id from public.keywords k
      where k.id = (e ->> 'id')::uuid
      for update
    ) k on true
    where k.updated_at is null
       or k.subject_id <> v_subject_id
       or k.updated_at <> (e ->> 'updatedAt')::timestamptz
  ) into v_stale;
  if v_stale then
    raise exception using errcode = 'P0001', message = 'stale_preview';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(p -> 'expected' -> 'questions', '[]'::jsonb)) e
    left join lateral (
      select q.updated_at, q.subject_id, q.deleted_at from public.questions q
      where q.id = (e ->> 'id')::uuid
      for update
    ) q on true
    where q.updated_at is null
       or q.deleted_at is not null
       or q.subject_id <> v_subject_id
       or q.updated_at <> (e ->> 'updatedAt')::timestamptz
  ) into v_stale;
  if v_stale then
    raise exception using errcode = 'P0001', message = 'stale_preview';
  end if;

  -- 2. キーワードの追加（親が先の順。sort_order は null とし、トリガーが兄弟の末尾に設定する）
  for v_elem in select value from jsonb_array_elements(coalesce(p -> 'keywordAdds', '[]'::jsonb))
  loop
    if nullif(v_elem ->> 'parentTempKey', '') is not null then
      v_parent := (v_kw_map ->> (v_elem ->> 'parentTempKey'))::uuid;
      if v_parent is null then
        raise exception using errcode = 'P0001', message = 'temp_key_unresolved';
      end if;
    else
      v_parent := nullif(v_elem ->> 'parentId', '')::uuid;
    end if;

    insert into public.keywords (subject_id, parent_id, name, sort_order)
    values (v_subject_id, v_parent, v_elem ->> 'name', null)
    returning id into v_new_id;

    v_kw_map := v_kw_map || jsonb_build_object(v_elem ->> 'tempKey', v_new_id);
    v_added := v_added + 1;
  end loop;

  -- 3. 改名（名前の入れ替えで兄弟名の一意制約に一時衝突しないよう、退避名を経由する）
  update public.keywords k
  set name = k.name || ' ' || k.id::text
  from jsonb_array_elements(coalesce(p -> 'keywordRenames', '[]'::jsonb)) e
  where k.id = (e ->> 'id')::uuid
    and k.subject_id = v_subject_id;

  for v_elem in select value from jsonb_array_elements(coalesce(p -> 'keywordRenames', '[]'::jsonb))
  loop
    update public.keywords k
    set name = v_elem ->> 'name'
    where k.id = (v_elem ->> 'id')::uuid
      and k.subject_id = v_subject_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'keyword_not_found';
    end if;
    v_renamed := v_renamed + 1;
  end loop;

  -- 4. 移動（循環・科目の不一致・兄弟名の重複は上流が拒否する）
  for v_elem in select value from jsonb_array_elements(coalesce(p -> 'keywordMoves', '[]'::jsonb))
  loop
    if nullif(v_elem ->> 'parentTempKey', '') is not null then
      v_parent := (v_kw_map ->> (v_elem ->> 'parentTempKey'))::uuid;
      if v_parent is null then
        raise exception using errcode = 'P0001', message = 'temp_key_unresolved';
      end if;
    else
      v_parent := nullif(v_elem ->> 'parentId', '')::uuid;
    end if;
    perform public.move_keyword((v_elem ->> 'id')::uuid, v_parent);
    v_moved := v_moved + 1;
  end loop;

  -- 5. 問題の修正（ID 不変）と新規作成。keywordIds の一時キーを解決して上流の保存 RPC を呼ぶ
  for v_elem in
    select value || jsonb_build_object('_create', false)
    from jsonb_array_elements(coalesce(p -> 'questionUpdates', '[]'::jsonb))
    union all
    select value || jsonb_build_object('_create', true)
    from jsonb_array_elements(coalesce(p -> 'questionCreates', '[]'::jsonb))
  loop
    v_input := coalesce(v_elem -> 'input', '{}'::jsonb);

    v_keyword_ids := '[]'::jsonb;
    for v_ref in select value from jsonb_array_elements_text(coalesce(v_input -> 'keywordIds', '[]'::jsonb))
    loop
      if v_ref like 'tmp:%' then
        if (v_kw_map ->> substr(v_ref, 5)) is null then
          raise exception using errcode = 'P0001', message = 'temp_key_unresolved';
        end if;
        v_ref := v_kw_map ->> substr(v_ref, 5);
      end if;
      v_keyword_ids := v_keyword_ids || to_jsonb(v_ref);
    end loop;

    v_input := v_input || jsonb_build_object('keywordIds', v_keyword_ids, 'subjectId', v_subject_id);

    if (v_elem ->> '_create')::boolean then
      v_new_id := public.save_question(v_input - 'id');
      if nullif(v_elem ->> 'tempKey', '') is not null then
        v_q_map := v_q_map || jsonb_build_object(v_elem ->> 'tempKey', v_new_id);
      end if;
      v_created := v_created + 1;
    else
      if nullif(v_input ->> 'id', '') is null then
        raise exception using errcode = 'P0001', message = 'question_not_found';
      end if;
      perform public.save_question(v_input);
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- 6. 無効化
  for v_elem in select value from jsonb_array_elements(coalesce(p -> 'questionDisables', '[]'::jsonb))
  loop
    perform public.set_question_disabled((v_elem ->> 'id')::uuid, true, v_elem ->> 'reason');
    v_disabled := v_disabled + 1;
  end loop;

  -- 7. 修正した問題の未解消フラグを解消済みにする（最後に呼ぶ。question_flags へは直接書き込まない）
  v_resolved := quiz_private.resolve_question_flags(
    array(select value::uuid from jsonb_array_elements_text(coalesce(p -> 'modifiedQuestionIds', '[]'::jsonb)))
  );

  return jsonb_build_object(
    'keywordIds', v_kw_map,
    'questionIds', v_q_map,
    'counts', jsonb_build_object(
      'keywordsAdded', v_added,
      'keywordsRenamed', v_renamed,
      'keywordsMoved', v_moved,
      'questionsUpdated', v_updated,
      'questionsCreated', v_created,
      'questionsDisabled', v_disabled
    ),
    'resolvedFlagCount', v_resolved
  );
end;
$$;

revoke all on function public.apply_exchange_import(jsonb) from public, anon;
grant execute on function public.apply_exchange_import(jsonb) to authenticated;

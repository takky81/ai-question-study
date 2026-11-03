-- subject-catalog: RPC と部分木関数、実行権限、問題・キーワードの RLS 補強
-- すべて呼び出し側の権限（RLS 下）で実行し、search_path を空にしてスキーマ修飾する。
-- 内部で commit しないため、他の RPC（取込など）のトランザクション内から呼び出せる。
-- 失敗は errcode P0001 と固定の例外メッセージ（エラーコード）で通知する。

-- ============================================================
-- RLS の補強（科目の所有者検査）
-- ============================================================

-- 外部キー検査は RLS を経由しないため、他人の subject_id を指定した問題・キーワードの
-- 作成・付け替えを WITH CHECK で拒否する（20261104000000 は適用済みのためここで作り直す）
drop policy questions_owner on public.questions;
create policy questions_owner on public.questions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.subjects s
      where s.id = subject_id
        and s.owner_id = (select auth.uid())
    )
  );

drop policy keywords_owner on public.keywords;
create policy keywords_owner on public.keywords
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.subjects s
      where s.id = subject_id
        and s.owner_id = (select auth.uid())
    )
  );

-- ============================================================
-- 型
-- ============================================================

-- 問題一覧の1行
create type public.question_list_row as (
  id uuid,
  kind text,
  stem text,
  created_at timestamptz,
  disabled_at timestamptz,
  keyword_ids uuid[]
);

-- キーワード削除の影響件数
create type public.keyword_deletion_impact as (
  keyword_count int,
  unlinked_question_count int,
  disabled_question_count int
);

-- ============================================================
-- 部分木
-- ============================================================

-- 自身を含む配下のキーワード ID を重複なく返す（存在しない ID は0行）
create function public.keyword_subtree_ids(p_keyword_id uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive subtree (id) as (
    select k.id from public.keywords k where k.id = p_keyword_id
    union
    select k.id
    from public.keywords k
    join subtree s on k.parent_id = s.id
  )
  select subtree.id from subtree;
$$;

-- ============================================================
-- 問題の保存
-- ============================================================

-- 問題・選択肢・紐づけを一体として作成・更新する（既存 ID は保つ）
create function public.save_question(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_choices jsonb := coalesce(p -> 'choices', '[]'::jsonb);
  v_keyword_ids uuid[];
  v_choice_ids uuid[];
  v_elem jsonb;
  v_pos int;
  v_choice_id uuid;
begin
  select coalesce(array_agg(value::uuid), '{}')
  into v_keyword_ids
  from jsonb_array_elements_text(coalesce(p -> 'keywordIds', '[]'::jsonb));

  -- 紐づけ0件の問題は出題対象にできないため保存しない
  if cardinality(v_keyword_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'no_keyword';
  end if;

  select coalesce(array_agg((e ->> 'id')::uuid), '{}')
  into v_choice_ids
  from jsonb_array_elements(v_choices) e
  where nullif(e ->> 'id', '') is not null;

  -- 同じ選択肢 ID の重複指定は上書きにせず拒否する
  if cardinality(v_choice_ids) <> (select count(distinct x) from unnest(v_choice_ids) x) then
    raise exception using errcode = 'P0001', message = 'duplicate_choice_id';
  end if;

  if v_id is null then
    insert into public.questions (subject_id, kind, stem, explanation)
    values ((p ->> 'subjectId')::uuid, p ->> 'kind', p ->> 'stem', p ->> 'explanation')
    returning id into v_id;
  else
    -- 科目は変更しない（ID 不変の更新）
    update public.questions q
    set kind = p ->> 'kind',
        stem = p ->> 'stem',
        explanation = p ->> 'explanation',
        updated_at = now()
    where q.id = v_id
      and q.deleted_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'question_not_found';
    end if;
  end if;

  -- 入力の既存 ID はこの問題の有効な選択肢でなければならない
  if exists (
    select 1
    from unnest(v_choice_ids) as x (id)
    where not exists (
      select 1 from public.choices c
      where c.id = x.id and c.question_id = v_id and c.removed_at is null
    )
  ) then
    raise exception using errcode = 'P0001', message = 'choice_not_in_question';
  end if;

  -- 表示順・正解の一意 index の一時衝突を避けるため、有効な選択肢を退避する
  update public.choices c
  set position = -c.position - 1,
      is_correct = false
  where c.question_id = v_id
    and c.removed_at is null;

  -- 入力にない既存の選択肢は行を残して外す
  update public.choices c
  set removed_at = now()
  where c.question_id = v_id
    and c.removed_at is null
    and c.id <> all (v_choice_ids);

  v_pos := 0;
  for v_elem in select value from jsonb_array_elements(v_choices)
  loop
    v_choice_id := nullif(v_elem ->> 'id', '')::uuid;
    if v_choice_id is null then
      insert into public.choices (question_id, position, body, explanation, is_correct)
      values (v_id, v_pos, v_elem ->> 'body', v_elem ->> 'explanation',
              coalesce((v_elem ->> 'isCorrect')::boolean, false));
    else
      update public.choices c
      set position = v_pos,
          body = v_elem ->> 'body',
          explanation = v_elem ->> 'explanation',
          is_correct = coalesce((v_elem ->> 'isCorrect')::boolean, false)
      where c.id = v_choice_id;
    end if;
    v_pos := v_pos + 1;
  end loop;

  -- 紐づけを入力の集合に置き換える（科目の一致はトリガーで検査する）
  delete from public.question_keywords qk
  where qk.question_id = v_id
    and qk.keyword_id <> all (v_keyword_ids);

  insert into public.question_keywords (question_id, keyword_id)
  select v_id, x.id
  from (select distinct unnest(v_keyword_ids) as id) x
  on conflict (question_id, keyword_id) do nothing;

  -- 正解がちょうど1つであることはコミット時の遅延トリガーで検査する
  return v_id;
end;
$$;

-- ============================================================
-- キーワード
-- ============================================================

-- 部分木を移動し、移動先の兄弟の末尾に置く（移動先 null は科目直下）
create function public.move_keyword(p_keyword_id uuid, p_new_parent_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_sort int;
begin
  select k.subject_id into v_subject_id
  from public.keywords k
  where k.id = p_keyword_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'keyword_not_found';
  end if;

  select coalesce(max(k.sort_order) + 1, 0) into v_sort
  from public.keywords k
  where k.subject_id = v_subject_id
    and k.parent_id is not distinct from p_new_parent_id
    and k.id <> p_keyword_id;

  begin
    -- 循環・科目の不一致は keywords のトリガーが拒否する
    update public.keywords k
    set parent_id = p_new_parent_id,
        sort_order = v_sort
    where k.id = p_keyword_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'duplicate_sibling';
  end;
end;
$$;

-- 兄弟全件の新しい順序を設定する（兄弟集合が一致しなければ拒否）
create function public.reorder_keywords(p_subject_id uuid, p_parent_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_ordered_ids), 0) <> (select count(distinct x) from unnest(p_ordered_ids) x)
     or exists (
       (select k.id from public.keywords k
        where k.subject_id = p_subject_id and k.parent_id is not distinct from p_parent_id)
       except
       select unnest(p_ordered_ids)
     )
     or exists (
       select unnest(p_ordered_ids)
       except
       select k.id from public.keywords k
       where k.subject_id = p_subject_id and k.parent_id is not distinct from p_parent_id
     )
  then
    raise exception using errcode = 'P0001', message = 'sibling_set_mismatch';
  end if;

  update public.keywords k
  set sort_order = o.ord - 1
  from unnest(p_ordered_ids) with ordinality as o (id, ord)
  where k.id = o.id
    and k.sort_order is distinct from o.ord - 1;
end;
$$;

-- 削除の影響件数を変更なしで集計する
-- unlinked: 部分木に紐づく未削除の問題、disabled: そのうち部分木外の紐づけが残らず、新たに無効化される問題
create function public.preview_keyword_deletion(p_keyword_id uuid)
returns public.keyword_deletion_impact
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result public.keyword_deletion_impact;
begin
  with subtree as (
    select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id)
  ),
  affected as (
    select q.id, q.disabled_at,
      not exists (
        select 1 from public.question_keywords qk2
        where qk2.question_id = q.id
          and qk2.keyword_id not in (select subtree.id from subtree)
      ) as loses_all
    from public.questions q
    where q.deleted_at is null
      and exists (
        select 1 from public.question_keywords qk
        where qk.question_id = q.id
          and qk.keyword_id in (select subtree.id from subtree)
      )
  )
  select
    (select count(*) from subtree)::int,
    (select count(*) from affected)::int,
    (select count(*) from affected where loses_all and disabled_at is null)::int
  into v_result.keyword_count, v_result.unlinked_question_count, v_result.disabled_question_count;

  return v_result;
end;
$$;

-- 部分木を削除し、紐づけをすべて失う問題を no_keyword で無効化する
create function public.delete_keyword(p_keyword_id uuid)
returns public.keyword_deletion_impact
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result public.keyword_deletion_impact;
begin
  v_result := public.preview_keyword_deletion(p_keyword_id);

  update public.questions q
  set disabled_at = now(),
      disabled_reason = 'no_keyword'
  where q.deleted_at is null
    and q.disabled_at is null
    and exists (
      select 1 from public.question_keywords qk
      where qk.question_id = q.id
        and qk.keyword_id in (select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id))
    )
    and not exists (
      select 1 from public.question_keywords qk2
      where qk2.question_id = q.id
        and qk2.keyword_id not in (select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id))
    );

  -- 配下のキーワードと紐づけは cascade で消える
  delete from public.keywords k where k.id = p_keyword_id;

  return v_result;
end;
$$;

-- ============================================================
-- 科目
-- ============================================================

-- 科目を論理削除し、配下の問題を削除状態に、キーワードを削除する
create function public.delete_subject(p_subject_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.subjects s
  set deleted_at = now()
  where s.id = p_subject_id
    and s.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'subject_not_found';
  end if;

  update public.questions q
  set deleted_at = now()
  where q.subject_id = p_subject_id
    and q.deleted_at is null;

  delete from public.keywords k where k.subject_id = p_subject_id;
end;
$$;

-- ============================================================
-- 問題の状態と検索
-- ============================================================

-- 無効化（理由は空なら null）と有効化（紐づけ0件なら拒否）
create function public.set_question_disabled(p_question_id uuid, p_disabled boolean, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted_at timestamptz;
begin
  select q.deleted_at into v_deleted_at
  from public.questions q
  where q.id = p_question_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'question_not_found';
  end if;
  if v_deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'question_deleted';
  end if;

  if p_disabled then
    update public.questions q
    set disabled_at = now(),
        disabled_reason = nullif(btrim(p_reason), '')
    where q.id = p_question_id;
  else
    if not exists (
      select 1 from public.question_keywords qk where qk.question_id = p_question_id
    ) then
      raise exception using errcode = 'P0001', message = 'no_keyword';
    end if;
    update public.questions q
    set disabled_at = null,
        disabled_reason = null
    where q.id = p_question_id;
  end if;
end;
$$;

-- 絞り込み付きの問題検索（新しい順、同時刻は ID 順）。未指定の条件は null
create function public.search_questions(
  p_subject_id uuid,
  p_keyword_id uuid,
  p_kind text,
  p_status text,
  p_text text
)
returns setof public.question_list_row
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  -- 部分一致語の \ % _ をエスケープする
  v_pattern text := case
    when nullif(p_text, '') is null then null
    else '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
begin
  return query
  select
    q.id,
    q.kind,
    q.stem,
    q.created_at,
    q.disabled_at,
    coalesce(
      (select array_agg(qk.keyword_id order by qk.keyword_id)
       from public.question_keywords qk where qk.question_id = q.id),
      '{}'::uuid[]
    )
  from public.questions q
  where q.deleted_at is null
    and q.subject_id = p_subject_id
    and (p_keyword_id is null or exists (
      select 1 from public.question_keywords qk
      where qk.question_id = q.id
        and qk.keyword_id in (select s.id from public.keyword_subtree_ids(p_keyword_id) as s (id))
    ))
    and (p_kind is null or q.kind = p_kind)
    and (p_status is null
      or (p_status = 'active' and q.disabled_at is null)
      or (p_status = 'disabled' and q.disabled_at is not null))
    and (v_pattern is null
      or q.stem ilike v_pattern
      or q.explanation ilike v_pattern
      or exists (
        select 1 from public.choices c
        where c.question_id = q.id
          and c.removed_at is null
          and (c.body ilike v_pattern or c.explanation ilike v_pattern)
      ))
  order by q.created_at desc, q.id desc;
end;
$$;

-- ============================================================
-- 実行権限（認証済みユーザーだけ）
-- ============================================================

revoke all on function public.keyword_subtree_ids(uuid) from public, anon;
revoke all on function public.save_question(jsonb) from public, anon;
revoke all on function public.move_keyword(uuid, uuid) from public, anon;
revoke all on function public.reorder_keywords(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.preview_keyword_deletion(uuid) from public, anon;
revoke all on function public.delete_keyword(uuid) from public, anon;
revoke all on function public.delete_subject(uuid) from public, anon;
revoke all on function public.set_question_disabled(uuid, boolean, text) from public, anon;
revoke all on function public.search_questions(uuid, uuid, text, text, text) from public, anon;

grant execute on function public.keyword_subtree_ids(uuid) to authenticated;
grant execute on function public.save_question(jsonb) to authenticated;
grant execute on function public.move_keyword(uuid, uuid) to authenticated;
grant execute on function public.reorder_keywords(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.preview_keyword_deletion(uuid) to authenticated;
grant execute on function public.delete_keyword(uuid) to authenticated;
grant execute on function public.delete_subject(uuid) to authenticated;
grant execute on function public.set_question_disabled(uuid, boolean, text) to authenticated;
grant execute on function public.search_questions(uuid, uuid, text, text, text) to authenticated;

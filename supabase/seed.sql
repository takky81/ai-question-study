-- ローカル開発用の seed。spec ごとにコメントで区切った節に追記し、他 spec の節は書き換えない。
-- このファイルはローカルの `supabase db reset` でのみ適用され、本番には適用しない。

-- ============================================================
-- app-foundation: ローカル専用の所有者アカウント
-- メール: owner@example.com / パスワード: owner-password-local（E2E でも使う固定値。秘密情報ではない）
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'owner@example.com',
  extensions.crypt('owner-password-local', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}',
  now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'email',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"owner@example.com","email_verified":true}',
  now(), now(), now()
);
-- ============================================================
-- app-foundation ここまで
-- ============================================================

-- ============================================================
-- subject-catalog: RLS 検証用の2人目のローカル専用アカウント
-- メール: other@example.com / パスワード: other-password-local（テストで使う固定値。秘密情報ではない）
-- 所有者アカウントと同じ方式で作成し、科目や問題は持たせない
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-4222-8222-222222222222',
  'authenticated', 'authenticated', 'other@example.com',
  extensions.crypt('other-password-local', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}',
  now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  '22222222-2222-4222-8222-222222222222',
  'email',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"other@example.com","email_verified":true}',
  now(), now(), now()
);
-- ============================================================
-- subject-catalog ここまで
-- ============================================================

-- 手動の動作確認用のデモデータ（科目「デモ: ネットワーク基礎」）。
-- seed.sql とは別にし、db reset では読み込まない（E2E の期待値に影響させないため）。
-- 適用: docker exec -i supabase_db_ai-question-study psql -U postgres -v ON_ERROR_STOP=1 < supabase/demo-data.sql
-- 何度実行しても同じ状態になる（既存のデモ科目を消してから入れ直す）。

begin;

-- 既存のデモ科目を消す。保護テーブルは FK が on delete restrict のため、子の行から直接消す
set local session_replication_role = replica;
delete from public.question_flags where question_id in (select id from public.questions where subject_id = 'de000000-0000-4000-8000-000000000001');
delete from public.srs_states where question_id in (select id from public.questions where subject_id = 'de000000-0000-4000-8000-000000000001');
delete from public.answers where question_id in (select id from public.questions where subject_id = 'de000000-0000-4000-8000-000000000001');
delete from public.question_keywords where question_id in (select id from public.questions where subject_id = 'de000000-0000-4000-8000-000000000001');
delete from public.choices where question_id in (select id from public.questions where subject_id = 'de000000-0000-4000-8000-000000000001');
delete from public.questions where subject_id = 'de000000-0000-4000-8000-000000000001';
delete from public.keywords where subject_id = 'de000000-0000-4000-8000-000000000001';
delete from public.subjects where id = 'de000000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

-- 解答履歴の直接書き込みを許可する（トランザクション内だけ有効）
select set_config('quiz.write_via_rpc', 'on', true);

insert into public.subjects (id, owner_id, name) values
  ('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'デモ: ネットワーク基礎');

-- キーワード: ネットワーク > (OSI 参照モデル, TCP/IP > (IP, TCP・UDP)), セキュリティ > 暗号
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('de000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', null, 'ネットワーク', 0),
  ('de000000-0000-4000-8000-0000000000a5', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', null, 'セキュリティ', 1);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('de000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-0000000000a1', 'OSI 参照モデル', 0),
  ('de000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-0000000000a1', 'TCP/IP', 1),
  ('de000000-0000-4000-8000-0000000000a6', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-0000000000a5', '暗号', 0);
insert into public.keywords (id, owner_id, subject_id, parent_id, name, sort_order) values
  ('de000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-0000000000a3', 'IP', 0),
  ('de000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-0000000000a3', 'TCP・UDP', 1);

-- 問題: (番号, キーワード, 問題文, 解説, 正解の位置, 選択肢4つ, 解答数, 正答数)
create temporary table demo_q (
  n int, kw text, stem text, expl text, correct int, c text[], attempts int, corrects int
) on commit drop;
insert into demo_q values
  (1, 'a2', 'OSI 参照モデルで、経路選択（ルーティング）を担う層はどれか。', 'ルーティングはネットワーク層（第3層）の役割である。',
   2, array['データリンク層', 'ネットワーク層', 'トランスポート層', 'セッション層'], 6, 5),
  (2, 'a2', 'OSI 参照モデルで、MAC アドレスを使って隣接ノード間の転送を行う層はどれか。', 'MAC アドレスはデータリンク層（第2層）で使う。',
   1, array['データリンク層', '物理層', 'ネットワーク層', 'アプリケーション層'], 4, 2),
  (3, 'a2', 'OSI 参照モデルの第7層はどれか。', '第7層はアプリケーション層で、利用者に最も近い層である。',
   4, array['プレゼンテーション層', 'セッション層', 'トランスポート層', 'アプリケーション層'], 3, 3),
  (4, 'b1', 'IPv4 アドレスのビット長はどれか。', 'IPv4 は 32 ビット、IPv6 は 128 ビットである。',
   1, array['32 ビット', '48 ビット', '64 ビット', '128 ビット'], 8, 7),
  (5, 'b1', '192.168.10.0/24 のネットワークで、ホストに割り当てられるアドレスの数はどれか。', '/24 は 256 個だが、ネットワークアドレスとブロードキャストアドレスを除いて 254 個になる。',
   3, array['24', '256', '254', '255'], 5, 1),
  (6, 'b1', 'プライベート IP アドレスの範囲に含まれるものはどれか。', '172.16.0.0〜172.31.255.255 はクラス B のプライベートアドレスである。',
   2, array['8.8.8.8', '172.20.1.5', '203.0.113.10', '1.1.1.1'], 2, 0),
  (7, 'b2', 'TCP の特徴として正しいものはどれか。', 'TCP はコネクション型で、到達確認と再送により信頼性を確保する。',
   3, array['コネクションレス型である', 'ヘッダが 8 バイト固定である', '再送制御を行う', 'ブロードキャストに使う'], 7, 6),
  (8, 'b2', 'DNS の問い合わせで主に使われるトランスポート層のプロトコルとポート番号の組はどれか。', 'DNS の通常の問い合わせは UDP の 53 番を使う（応答が大きい場合などは TCP も使う）。',
   4, array['TCP 25', 'TCP 80', 'UDP 123', 'UDP 53'], 3, 1),
  (9, 'b2', 'TCP の 3 ウェイハンドシェイクで最初に送られるセグメントはどれか。', 'SYN → SYN+ACK → ACK の順で接続を確立する。',
   1, array['SYN', 'ACK', 'FIN', 'RST'], 0, 0),
  (10, 'a6', '公開鍵暗号方式で、送信者が受信者に秘密のメッセージを送るとき暗号化に使う鍵はどれか。', '受信者の公開鍵で暗号化し、受信者だけが持つ秘密鍵で復号する。',
   2, array['送信者の秘密鍵', '受信者の公開鍵', '送信者の公開鍵', '受信者の秘密鍵'], 9, 4),
  (11, 'a6', 'ハッシュ関数の性質として適切なものはどれか。', 'ハッシュ値から元のデータを求めることが困難（一方向性）である。',
   3, array['ハッシュ値から元のデータを復元できる', '入力が長いほどハッシュ値も長くなる', 'ハッシュ値から元のデータを求めるのは困難である', '鍵がないと計算できない'], 4, 4),
  (12, 'a5', 'パスワードの総当たり攻撃への対策として最も効果が高いものはどれか。', '一定回数の失敗でアカウントをロックすると、総当たりの試行を大きく制限できる。',
   1, array['一定回数の失敗でアカウントをロックする', 'パスワードを画面に表示しない', 'ログイン画面のデザインを変える', 'パスワードを紙に書いて保管する'], 0, 0);

insert into public.questions (id, owner_id, subject_id, kind, stem, explanation, created_at, updated_at)
select ('de000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
       'de000000-0000-4000-8000-000000000001', 'keyword', stem, expl,
       now() - make_interval(days => 30 - n), now() - make_interval(days => 30 - n)
from demo_q;

insert into public.choices (id, owner_id, question_id, position, body, explanation, is_correct)
select ('de000000-0000-4000-8000-00000000' || lpad(n::text, 2, '0') || lpad(p::text, 2, '0'))::uuid,
       '11111111-1111-4111-8111-111111111111',
       ('de000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid,
       p - 1, c[p],
       case when p = correct then '正解。' || expl else '不正解。' || expl end,
       p = correct
from demo_q, generate_series(1, 4) as p;

insert into public.question_keywords (question_id, keyword_id, owner_id)
select ('de000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid,
       ('de000000-0000-4000-8000-0000000000' || kw)::uuid,
       '11111111-1111-4111-8111-111111111111'
from demo_q;

-- 解答履歴: 問題ごとに attempts 件を過去 1 日おきに入れ、先頭の corrects 件を正解にする
insert into public.answers (owner_id, question_id, choice_id, answer_kind, is_correct, client_answer_id, answered_at)
select '11111111-1111-4111-8111-111111111111',
       ('de000000-0000-4000-8000-0000000010' || lpad(n::text, 2, '0'))::uuid,
       ('de000000-0000-4000-8000-00000000' || lpad(n::text, 2, '0')
         || lpad((case when i <= corrects then correct else correct % 4 + 1 end)::text, 2, '0'))::uuid,
       'normal', i <= corrects, gen_random_uuid(), now() - make_interval(days => attempts - i + 1)
from demo_q, generate_series(1, attempts) as i;

commit;

# Research & Design Decisions

## Summary

- **Feature**: `subject-catalog`
- **Discovery Scope**: New Feature（app-foundation の上に最初の業務スキーマを追加する。コードベースは未実装で、上流の design.md の契約を前提とする）
- **Key Findings**:
  - 解答履歴（quiz-session）が問題と選択肢を外部キーで参照するため、問題・選択肢・科目は物理削除せず論理削除にする必要がある
  - 「正解はちょうど1つ」は、行単位の CHECK では表現できず、部分 unique index（最大1つ）と遅延制約トリガー（最低1つ）の組み合わせで保証できる
  - キーワード部分木の取得は、TS（画面内の木）と SQL（絞り込み・下流の集計ビュー）の両方で必要になる

## Research Log

### 上流契約の確認

- **Context**: app-foundation が提供する契約を再定義しないため
- **Sources Consulted**: `.kiro/specs/app-foundation/design.md`
- **Findings**: `APP_ROUTES` への行追加、`NavGroup = 'manage'`、`fetchAllPages(fetchPage, context)`、テーマトークン（`--c-correct`、`--c-warn`）と共通 class（`.focus-ring`、`.tap-target`、`.mark-correct`）、`supabase` client、seed の所有者アカウントが利用できる
- **Implications**: 本 spec は `routes.tsx` に行を足し、`seed.sql` に RLS 検証用アカウントを足すだけで、上流ファイルの構造は変えない

### 削除と履歴の扱い

- **Context**: brief が「解答履歴がある問題を削除するときの扱い」を本 spec で決めるよう求めている
- **Findings**: 履歴の有無を本 spec が判定すると quiz-session への依存が生じる（依存方向の逆転）。常に論理削除にすれば履歴の有無に関わらず参照整合性が保たれる
- **Implications**: `questions.deleted_at`、`choices.removed_at`、`subjects.deleted_at` を採用し、物理削除の API は提供しない。キーワードは履歴から参照されないため物理削除とする

### 正解1つの DB 保証

- **Context**: 5.10 の「正解が1つ」を DB 側で保証する
- **Findings**: PostgreSQL の部分 unique index で `is_correct` の重複を防げる。0件の禁止は集約条件のため、`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` でコミット時に検査するのが標準的な方法
- **Implications**: `save_question` 内の選択肢入れ替え中の一時的な0件は許容され、コミット時に検査される

### 階層と循環

- **Context**: 任意の深さの木、移動、循環禁止
- **Findings**: 隣接リスト（`parent_id`）+ 再帰 CTE は PostgreSQL 標準で、移動が1行の更新で済む。経路列（ltree、materialized path）は移動時に部分木全体の更新が必要になる
- **Implications**: 隣接リストを採用し、循環はトリガーで祖先を辿って拒否する。兄弟名の一意性は PostgreSQL 15 以降の `NULLS NOT DISTINCT` で科目直下も含めて表現できる

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| -------- | ------------- | ----------- | --------------------- | ------- |
| 隣接リスト + 再帰 CTE | `parent_id` で親を参照 | 移動・改名が1行更新、ID 不変 | 深い木の取得は再帰が必要 | 採用 |
| materialized path / ltree | 経路を列に保持 | 部分木検索が速い | 移動で部分木の全行を更新 | 規模に対して過剰 |
| クロージャテーブル | 祖先・子孫の組を保持 | 任意の祖先検索が速い | 移動時の更新が複雑 | 不採用 |

## Design Decisions

### Decision: 二層検証（DB 制約 + TS 純粋関数）

- **Context**: 作問ルールは手動編集と取込の両方で使い、原則（警告）と必須（エラー）が混在する
- **Alternatives Considered**:
  1. すべてを DB 制約で表現する
  2. TS の純粋関数で作問ルール、DB は最低限の整合性
- **Selected Approach**: 2。`validateQuestion` が重大度付きの指摘を返し、DB は正解1つ・同一科目・循環なし・空文字禁止だけを保証する
- **Rationale**: 警告は保存を止めないため DB 制約にできない。取込のプレビューでも同じ指摘を表示できる
- **Trade-offs**: クライアントを経由しない書き込みは作問ルールを満たさない可能性があるが、個人用途で書き込み経路はアプリに限られる

### Decision: キーワード削除時の問題の扱い

- **Context**: brief の制約「キーワードを削除したときの問題の紐づけの扱いを定義する」
- **Alternatives Considered**:
  1. 紐づく問題がある限り削除を拒否する
  2. 紐づけを外し、紐づけがなくなった問題を削除する
  3. 紐づけを外し、紐づけがなくなった問題を無効化する
- **Selected Approach**: 3。理由 `no_keyword` を記録し、紐づけを付け直すまで有効に戻せない
- **Rationale**: 階層の整理を妨げず、問題と履歴を失わない。出題からは自動で外れる

### Decision: 部分木取得を TS と SQL の両方で提供する（一般化）

- **Context**: 画面の木操作（移動先候補）と、一覧の絞り込み・下流の集計ビューの両方で同じ「配下」の定義が必要
- **Selected Approach**: `keywordSubtreeIds`（TS）と `keyword_subtree_ids`（SQL）を同じ定義（自身を含む全子孫、重複なし）で提供し、両方をテストする
- **Trade-offs**: 実装が2つになるが、それぞれのデータの置き場所で計算でき、全件転送を避けられる

### Build vs. Adopt

- 木の UI は外部ライブラリを導入せず、WAI-ARIA の tree パターンに沿って自作する（依存追加を避け、操作数が少ないため）
- 部分一致検索は PostgreSQL 標準拡張の `pg_trgm` を採用する（Supabase で利用可能）
- 未保存変更の確認は React Router 7 の `useBlocker` を採用する（データルーターで利用可能）

### Simplification

- 問題の物理削除、科目の復元、選択肢の履歴表示は要件にないため設けない
- ドラッグ＆ドロップの並べ替えは設けず、上へ／下へと移動先選択のボタンで代替する（キーボード操作の要件を満たす最小の方法）

## Risks & Mitigations

- 略語の検出（英大文字2文字以上）が誤検知する — 警告に留め、保存を止めない
- `save_question` の `position` 一時衝突 — 先に負値へ退避してから書き込む
- 大量データでの検索性能 — trigram index とページ単位の取得。E2E で 1,050 件の欠落・重複なしを確認する

## References

- PostgreSQL 17 ドキュメント: CREATE TRIGGER（CONSTRAINT TRIGGER、DEFERRABLE）、WITH RECURSIVE、UNIQUE NULLS NOT DISTINCT、pg_trgm
- Supabase ドキュメント: Row Level Security、Database Functions（SECURITY INVOKER）
- WAI-ARIA Authoring Practices: Tree View パターン

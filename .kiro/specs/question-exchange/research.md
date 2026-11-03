# Research & Design Decisions

## Summary

- **Feature**: `question-exchange`
- **Discovery Scope**: Extension（app-foundation、subject-catalog、quiz-session の契約の上に、出力・取込・交換フォーマット・生成 skill を追加する。コードベースは未実装で、上流の design.md の契約を前提とする）
- **Key Findings**:
  - 取込 RPC は、上流の RPC（`save_question`、`move_keyword`、`set_question_disabled`）と内部関数 `quiz_private.resolve_question_flags` を同じトランザクション内で呼ぶことで、選択肢の論理削除・ID 不変・正解1つの遅延検査・フラグ解消の意味を再定義せずに再利用できる
  - 「プレビュー後の変更の検出」は、プレビュー作成時に対象のキーワード・問題の `updated_at` を記録し、取込 RPC の先頭で `for update` で行を固定して比較する楽観的同時実行制御で満たせる。上流のテーブルは共通トリガーで `updated_at` を更新するため、列の追加は不要
  - 交換フォーマットの正本を TS の型と検証関数に置き、skill 用のフォーマット文書と例のファイルを単体テストで照合すると、新しい npm 依存（JSON Schema 検証ライブラリ）なしでドリフトを防げる

## Research Log

### 上流契約の確認

- **Context**: 上流の契約を再定義しないため
- **Sources Consulted**: `.kiro/specs/app-foundation/design.md`、`.kiro/specs/subject-catalog/design.md`、`.kiro/specs/quiz-session/design.md`
- **Findings**:
  - app-foundation: `APP_ROUTES`／`AppRoute`（`nav.group = 'manage'`）、`fetchAllPages(fetchPage, context)`（1,000 件ずつ、失敗時は全体失敗）、`supabase`、`useAuth`、テーマトークン `--c-correct`、共通 class `.mark-correct`、`.focus-ring`、`.tap-target`
  - subject-catalog: テーブル `subjects`、`keywords`、`questions`、`choices`、`question_keywords`、`questions.disabled_at`／`disabled_reason`／`deleted_at`、`choices.removed_at`、ビュー `servable_questions`、SQL 関数 `keyword_subtree_ids`、RPC `save_question(p jsonb)`（`QuestionInput` 相当の JSON。`id` なしで新規、入力にない選択肢に `removed_at`）、`move_keyword`、`set_question_disabled`、TS の `validateQuestion`（`error`／`warning`）、`QuestionInput`、`buildKeywordTree`、`keywordPath`、`keywordSubtreeIds`。キーワードの兄弟名は `unique nulls not distinct (subject_id, parent_id, name)`、循環はトリガー `keyword_cycle`
  - quiz-session: テーブル `question_flags`（`status` は `open`／`resolved`）、ビュー `question_stats`（`retention` を含む、出題対象のみ）、`keyword_stats`（部分木を含む）、`QUESTION_FLAGS`／`QuestionFlagId`／`QuestionFlagStatus`（`src/features/quiz/flags.ts`）、内部関数 `quiz_private.resolve_question_flags(p_question_ids uuid[]) returns integer`（`authenticated` に `execute`、PostgREST 非公開）。取込 RPC は `question_flags` に直接書き込まない
- **Implications**: 本 spec は新しい migration と `src/features/exchange/` を追加し、`routes.tsx` に行を足すだけで上流のファイルを変更しない

### 出力の取得方式

- **Context**: 出力は 1,000 件を超えても欠落なく取得する必要がある（2.9）
- **Findings**: PostgREST は `setof` を返す RPC にも `range` を適用でき、`fetchAllPages` が使える。問題・選択肢・フラグを別々の RPC で取得すると、取得の合間に変更が入る可能性がある
- **Implications**: 3つの RPC が同じ内部関数で対象の問題 ID を決め、安定した順序で返す。クライアントの `buildExportFile` が整合性（選択肢のない問題、正解が1つでない問題）を検査し、不整合なら「出力中にデータが変更されました」として全体を失敗させる

### 交換フォーマットの検証方式

- **Context**: スキーマ検証を出力・取込・skill で共有する（3.9、4.2、4.3）
- **Findings**: subject-catalog と同様に npm 依存を追加しない方針。フォーマットは操作の種類が少なく、手書きの検証関数で十分に表現できる
- **Implications**: `format.ts`（型と定数）と `parse.ts`（未知の値を検証して型付きの値と問題箇所の一覧を返す）を正本とし、skill 側の英語のフォーマット文書と例のファイルを `formatDoc.test.ts` で照合する

### 生成 skill の構成

- **Context**: skill 本体は英語、生成内容は日本語。作問原則とフラグの表は `product.md` が正本（9.2〜9.4）
- **Findings**: 作問原則を skill に複写するとドリフトする。skill は実行時に `.kiro/steering/product.md` を読めばよい
- **Implications**: `.claude/skills/question-authoring/SKILL.md` は手順・フラグごとの対処方針・自己点検・報告形式だけを持ち、原則は `product.md` を読む。フォーマットは `references/exchange-format.md` と `references/example-import.json` を読む

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| -------- | ------------- | ----------- | --------------------- | ------- |
| 取込を1つの RPC で上流 RPC を呼んで適用 | クライアントで検証・差分計算、DB では競合検査と適用だけ | 上流の意味を再利用、原子性 | 上流 RPC の引数形式に依存 | 採用。依存を Revalidation Triggers に記載 |
| 取込 RPC がテーブルへ直接書き込む | 上流 RPC を使わない | 依存が少ない | 選択肢の論理削除・position 退避などを再実装 | 不採用 |
| 出力を単一の jsonb RPC で返す | 1回で全体を取得 | スナップショットが一貫 | 1,000 行上限の方針から外れ、巨大な単一応答 | 不採用 |

## Design Decisions

### Decision: フラグを解消する「修正」の範囲

- **Context**: brief が要件定義で決めるよう求めた項目
- **Alternatives Considered**:
  1. 取込ファイルに含まれた問題すべて
  2. 実際に内容が変わった問題（解説のみの変更を含む）
  3. 2 に加えて無効化した問題
- **Selected Approach**: 2。差分計算で「変更なし」の問題を適用対象から除き、残った修正の問題 ID だけを `resolve_question_flags` に渡す
- **Rationale**: 変更のない問題のフラグを消すと、未解消のフラグが「未対応」を表さなくなる。解説の追記は `needs_explanation` への対処そのもの。無効化はフラグの原因を直しておらず、有効に戻したときに指摘が必要になる
- **Trade-offs**: 無効化した問題のフラグが未解消のまま残るが、既定の出力は無効の問題を含めないため、生成の入力にはノイズにならない

### Decision: 無効化された問題の出力

- **Selected Approach**: 既定では含めず、条件で含められる。削除済みは常に含めない
- **Rationale**: 生成の入力を出題対象に絞りつつ、無効化した問題を直して再利用する経路を残す（ただし取込で有効化はできないため、手動で有効に戻す）

### Decision: 選択肢の削除・差し替え

- **Selected Approach**: 修正する問題は選択肢の全体を記述し、`save_question` の規則（ID 付き＝更新、ID なし＝追加、記述なし＝`removed_at`）に従う。意味が変わる差し替えは ID なしで書くことを skill の規則にする
- **Rationale**: 解答履歴は `choices.id` を参照するため、ID を別の意味に流用すると過去の解答の意味が変わる

### Decision: プレビュー後の変更の検出

- **Selected Approach**: プレビュー時に対象（更新・無効化する問題、改名・移動するキーワード、追加・移動先の親、紐づけ先のキーワード）の `updated_at` を `expected` として適用ペイロードに含める。取込 RPC は `for update` で固定して比較し、不一致・消失なら `stale_preview` で全体を中止する
- **Rationale**: 列の追加なしで実現でき、上流のどの経路の変更（手動編集、削除、別の取込）も検出できる
- **Trade-offs**: 対象外の要素（無関係なキーワードの追加など）は検出しないが、兄弟名の衝突は一意制約で失敗するため不整合にはならない

### Decision: 改名の一時衝突の回避

- **Selected Approach**: 改名は2段階（いったん `name || ' ' || id` に退避してから最終名にする）で行い、入れ替えのような改名でも一意制約に一時的に触れないようにする
- **Follow-up**: 移動による一時衝突はまれなため検証で事前に検出し、それでも起きた場合は全体を失敗させる

## Synthesis Outcomes

- **Generalization**: 出力の3つの RPC は対象の問題 ID を決める同じ内部関数 `exchange_private.export_target_ids` を使う
- **Build vs Adopt**: JSON Schema 検証ライブラリは採用せず、手書きの検証関数とテストで照合（依存追加なし）。キーワード木の計算は `@/lib/keywordTree` を採用
- **Simplification**: 取込の適用は上流 RPC の呼び出しに還元し、差分・検証はクライアントの純粋関数に集約する。取込による有効化・削除は扱わない

## Risks & Mitigations

- 上流 RPC の引数形式の変更で取込が壊れる — Revalidation Triggers に記載し、E2E で取込の全操作を検証する
- `quiz_private` の `usage` 権限がないと取込 RPC から呼べない — quiz-session の契約（`authenticated` に `execute`）を前提とし、E2E でフラグの解消を検証する
- 出力中の同時変更による不整合 — `buildExportFile` の整合性検査で全体を失敗させ、再試行を促す
- フォーマット文書と型のドリフト — `formatDoc.test.ts` で項目名・バージョン・例のファイルを照合する

## References

- `.kiro/steering/product.md` — 問題作成の原則、問題フラグの表
- `.kiro/steering/tech.md` — 交換用 JSON、ページング、RPC の規約
- `.kiro/specs/subject-catalog/design.md`、`.kiro/specs/quiz-session/design.md`、`.kiro/specs/app-foundation/design.md` — 上流契約

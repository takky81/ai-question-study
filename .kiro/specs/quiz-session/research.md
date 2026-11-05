# Research & Design Decisions

## Summary

- **Feature**: `quiz-session`
- **Discovery Scope**: Extension（app-foundation と subject-catalog の契約の上に、出題・解答履歴・SRS・フラグ・集計を追加する。コードベースは未実装で、上流の design.md の契約を前提とする）
- **Key Findings**:
  - 解答の記録・SRS 更新・`guessable` フラグの自動付与は、1つの RPC の単一トランザクションにまとめる必要がある。SRS の更新計算は SQL の不変関数として分離すると、原子性と「副作用のない関数」の両方を満たせる
  - 定着率は時刻に依存する値（忘却曲線）であるため、保存せずビューで `now()` から算出すると、出題順・統計・出力の全利用者が同じ値を見る
  - フラグ解消関数は「取込 RPC から呼べ、クライアントから呼べない」必要がある。PostgREST が公開しないスキーマに置き、`SECURITY INVOKER` のまま `authenticated` に `EXECUTE` を与えれば、RLS を保ったまま両立する

## Research Log

### 上流契約の確認

- **Context**: 上流の契約を再定義しないため
- **Sources Consulted**: `.kiro/specs/app-foundation/design.md`、`.kiro/specs/subject-catalog/design.md`
- **Findings**:
  - app-foundation: `APP_ROUTES`／`AppRoute`（`nav.group = 'learn'`）、`fetchAllPages(fetchPage, context)`、`supabase`、`useAuth`、テーマトークン `--c-correct`（赤）／`--c-incorrect`（青）、共通 class `.choice-selected`、`.mark-correct`、`.mark-incorrect`、`.focus-ring`、`.tap-target`
  - subject-catalog: テーブル `subjects`、`keywords`、`questions`、`choices`、`question_keywords`、ビュー `servable_questions`（`disabled_at is null and deleted_at is null`）、SQL 関数 `keyword_subtree_ids(p_keyword_id uuid) returns setof uuid`（自身を含む）、TS の `buildKeywordTree`、`keywordPath`、`keywordSubtreeIds`（`src/lib/keywordTree.ts`）、`choices.removed_at`、`catalog_private` スキーマの方式、解答履歴は `questions.id`／`choices.id` を外部キーで参照してよい
- **Implications**: 本 spec は `routes.tsx` に行を足し、新しい migration を追加するだけで上流のファイル構造は変えない。出題候補は必ず `servable_questions` を通す

### SRS の方式

- **Context**: brief は SRS の方式を設計で決め、定着率を1つの数値として公開することを求める
- **Sources Consulted**: SM-2 の安定度・容易度の考え方、指数型の忘却曲線（想起確率 R = 0.9^(経過日数 / 安定度)）
- **Findings**: 選択問題・個人利用・3段階の評価（正解／誤答／わからない）では、多数のパラメータを最適化する方式は過剰である。安定度（日）と容易度の2値と経過時間から想起確率を出す方式で、「定着率が低い順」に直接使える 0〜1 の値が得られる
- **Implications**: `srs_states` に安定度・容易度・回数を保存し、定着率はビューで算出する。評価は `good`（正解）、`again`（誤答）、`blackout`（わからない、最低評価）の3値とする

### クライアントから呼べない SQL 関数

- **Context**: tech.md の「他の RPC の内部からだけ呼ぶ SQL 関数は、クライアントから直接呼べないようにする」
- **Findings**: PostgREST は `config.toml` の `[api] schemas` に列挙したスキーマ（既定は `public`、`graphql_public`）の関数だけを公開する。`SECURITY INVOKER` の取込 RPC から呼ぶには、呼び出し元ロール（`authenticated`）にスキーマの `USAGE` と関数の `EXECUTE` が必要である
- **Implications**: `quiz_private.resolve_question_flags` を `quiz_private` スキーマに置き、`[api] schemas` に含めない。E2E で `rpc('resolve_question_flags')` と `schema('quiz_private')` の呼び出しが失敗することを確認する

### 集計ビューの性能

- **Context**: キーワードごとの集計は部分木を含む
- **Findings**: `keyword_subtree_ids` を各キーワードに `lateral` で適用すると、キーワード数 × 部分木の再帰になる。個人利用の規模（キーワード数千）では許容範囲で、契約上の部分木の定義を1か所に保てる
- **Implications**: `keyword_stats` は `keyword_subtree_ids` を使う。閉包テーブルの導入は性能問題が測定されてから検討する

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| -------- | ------------- | ----------- | --------------------- | ------- |
| SQL で SRS 更新を計算 | `record_answer` 内で不変関数 `srs_next` を呼ぶ | 原子性、二重計算なし、改ざん不可 | TS のユニットテストで検証できない | 採用。E2E で表形式の検証を行う |
| TS で計算し RPC に渡す | クライアントの純粋関数で次状態を計算 | Vitest で検証しやすい | 古い状態からの計算、正誤の改ざん、整合性検査の二重化 | 不採用 |
| 定着率を列として保存 | 解答時に値を保存 | 読み取りが単純 | 時間経過で値が古くなる | 不採用 |

## Design Decisions

### Decision: SRS の更新計算を SQL の不変関数にする

- **Context**: 3.2（記録と更新の一体性）と tech.md の「SRS の更新計算は副作用のない関数として分離する」
- **Alternatives Considered**:
  1. TS の純粋関数で計算し、RPC が結果を保存する
  2. SQL の `immutable` 関数で計算し、RPC 内で呼ぶ
- **Selected Approach**: 2。`quiz_private.srs_next` は入力の状態・評価・経過日数だけから次の状態を返す
- **Rationale**: 正誤の判定と状態の読み取り・更新を同じトランザクション内で行い、行ロックで並行解答の競合を防げる
- **Trade-offs**: 計算規則のテストはローカル Supabase 上の E2E（表形式の入力と期待値）になる
- **Follow-up**: 計算規則を変える場合は新しい migration で関数を置き換える

### Decision: 冪等な解答の記録

- **Context**: 3.4（再試行で1回だけ記録）
- **Selected Approach**: クライアントが解答ごとに `client_answer_id`（UUID）を生成し、再試行でも同じ値を送る。`answers` の unique `(owner_id, client_answer_id)` により、2回目は既存の結果を返して何も変更しない
- **Rationale**: 応答の喪失（記録済みだが応答が届かない）でも二重記録しない

### Decision: 出題セッションを DB に保存しない

- **Context**: 2.5（セッション内で1回ずつ）、10.6（終了で記録済みの解答を保持）
- **Selected Approach**: セッションは画面の React state（候補一覧と解答済み集合）に置く。解答は1件ごとに DB に記録されるため、終了・再読み込みで失われるのはセッションの進行だけである
- **Rationale**: 要件にセッションの再開はない。テーブルを増やさない（Simplification）

### Decision: フラグの状態と記録の外し方

- **Context**: 7.3〜7.5、8.1〜8.2
- **Selected Approach**: `question_flags` は1行1フラグ。`status` は `open`／`resolved`。未解消の同じフラグは部分 unique index で1つに限る。所有者がチェックを外した未解消のフラグは行を削除する（解消ではなく取り消しのため）。解消済みの行は変更・削除しない
- **Rationale**: 解消済みは履歴として残し、未解消は「現在の指摘」として常に一意に保てる

### Decision: 一般化（Generalization）

- 範囲選択（1.3）、キーワード集計（9.2）、候補取得はいずれも「キーワードの部分木に紐づく出題対象の問題」の特殊例であり、SQL では `keyword_subtree_ids` と `servable_questions` の組み合わせ1種類で表す
- 問題の成績表示（6.x）と集計（9.1）は同じ `question_stats` ビューを使い、解答直後は `record_answer` の返り値で同じ列を返す

### Decision: 採用と構築（Build vs. Adopt）

- SRS ライブラリ（FSRS の実装など）は採用しない。TS ライブラリでは DB 内の原子的更新に使えず、評価が3値の本機能には規則が少ない独自式で足りる
- 正誤表示・フォーカス・操作領域は app-foundation の共通 class を使い、新しい UI ライブラリを追加しない

### Decision: 簡素化（Simplification）

- セッション用テーブル、フラグ用の別状態テーブル、定着率の保存列を持たない
- 範囲内の候補件数は候補一覧の取得結果からクライアントで数え、件数専用の API を持たない

### Decision: 2026-11-05 要件変更（判定後の ○× 表示とフラグの自動保存）

- 背景: 4.3 を判定前だけに限定し、5.9（判定後は「？」の位置に ○／×）、7.2／7.4（チェックで即時保存）、7.5／7.9（blur で変更時だけコメント保存、空白なら外す）、7.10（保存ボタンなし）を追加した
- 調査: 既存の `save_question_flags` は集合全体を受けて未解消行を揃える冪等な RPC で、空のコメントでは行を削除する。1件ごとの追加・削除 RPC を作らなくても自動保存を実現できる
- 選択: DB・RPC は変更しない。クライアントに `flagAutosave.ts`（同時実行1件、実行中の変更は最新値に集約、完了後に差分があれば再送）を置き、順序の逆転を防ぐ。チェックの保存では blur で確定したコメントを送る
- 遷移時: blur は click より先に発火するため、「次へ」「終了」は `flush` を待ってから遷移し、失敗なら留まる
- 却下: 変更ごとの並列 RPC（順序逆転の恐れ）、デバウンス（7.2 の「待たずに」と合わず、遷移時の取りこぼしが増える）、保存中の「次へ」の無効化（blur 直後の click が無効なボタンに当たり操作が失われる）
- ChoiceList: 右端の 44px 列を判定前後で共有し、判定後は非ボタンの印セルにして本文の折り返しを変えない

## Risks & Mitigations

- 「？」エリアと選択領域の誤タップ — 「？」エリアを右端の独立したボタン（44px 以上、境界線と余白で分離）にし、E2E でモバイル幅のタップ位置を検証する
- 解答直後の定着率が高く見える（直後は想起確率が 1 に近い） — 忘却曲線の性質として受け入れる。誤答・わからないは安定度が小さく、短時間で値が下がる
- `quiz_private` を誤って `[api] schemas` に追加する — Revalidation Triggers に記載し、E2E で呼び出し不可を検証する
- キーワード集計の再帰コスト — 1,200 キーワードの seed で取得時間を E2E で確認し、問題があれば閉包テーブルを別 migration で追加する

## References

- `.kiro/specs/app-foundation/design.md` — ルート、テーマトークン、ページング
- `.kiro/specs/subject-catalog/design.md` — スキーマ、`servable_questions`、`keyword_subtree_ids`、`keywordTree.ts`
- `.kiro/steering/tech.md`、`.kiro/steering/product.md` — 実装標準、問題フラグの定義

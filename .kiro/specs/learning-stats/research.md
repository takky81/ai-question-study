# Research & Design Decisions

## Summary

- **Feature**: `learning-stats`
- **Discovery Scope**: Extension（app-foundation、subject-catalog、quiz-session の契約の上に、ビン分けの RPC と統計画面を追加する。コードベースは未実装で、上流の design.md の契約を前提とする）
- **Key Findings**:
  - 設問ごと・キーワードごとの集計値は quiz-session のビュー `question_stats`、`keyword_stats` がすでに確定している。本 spec は列を読むだけで、正答数・出題数・正答率を再計算しない
  - ヒストグラムの件数は DB 側で区間ごとに数えると、返る行数が区間の数（数十行）に収まり、1,000 行上限の影響を受けない。掘り下げの一覧だけは件数が多くなり得るため、`fetchAllPages` で取得し切る
  - 区間への振り分けを SQL の不変関数1か所に置き、件数の集計と掘り下げの一覧の両方から使うと、区間の件数と一覧の件数が定義上一致する

## Research Log

### 上流契約の確認

- **Context**: 上流の契約を再定義しないため
- **Sources Consulted**: `.kiro/specs/app-foundation/design.md`、`.kiro/specs/subject-catalog/design.md`、`.kiro/specs/quiz-session/design.md`
- **Findings**:
  - app-foundation: `APP_ROUTES`／`AppRoute`（`nav.group = 'learn'` は「出題・統計」の区分）、`fetchAllPages(fetchPage, context)`（`PAGE_SIZE = 1000`、一意順序は呼び出し側の責任、失敗時は部分結果を返さず `{context}に失敗しました: {message}`）、`supabase`、テーマトークン（`--c-bg`、`--c-surface`、`--c-text`、`--c-text-muted`、`--c-border`、`--c-primary`、`--c-correct`、`--c-incorrect`、`--c-warn`）、共通 class `.focus-ring`、`.tap-target`
  - subject-catalog: テーブル `subjects`（`deleted_at`）、`keywords`、`question_keywords`、ビュー `servable_questions`、SQL 関数 `keyword_subtree_ids(p_keyword_id uuid) returns setof uuid`（自身を含み、存在しない ID は0行）、`src/lib/keywordTree.ts` の `KeywordNode`、`buildKeywordTree`、`keywordPath`、型 `Subject`、`Keyword`、問題編集のルート `catalog/:subjectId/questions/:questionId`
  - quiz-session: `public.question_stats`（`question_id`、`subject_id`、`attempt_count`、`correct_count`、`correct_rate`（出題数0は null）、`last_answered_at`、`review_count`、`retention`。出題対象の問題だけ。`answers` の全種類を数え、`unknown` は誤答）、`public.keyword_stats`（`keyword_id`、`subject_id`、`question_count`、`attempt_count`、`correct_count`、`correct_rate`。部分木を `distinct` で集計し、無効・削除を除外）。両ビューとも `security_invoker = true`。`quiz` ルートは `group: 'learn'`、`order: 1`。下流が import してよい TS は `@/features/quiz/flags` だけ
- **Implications**: 正答率の区間は `correct_count` と `attempt_count` の整数から求める（ビューの値をそのまま使い、浮動小数の境界誤差を避ける）。quiz の `KeywordRangePicker` や `stats.ts` は import できないため、本 spec の範囲選択と表示用の関数は stats 内に持つ

### 区間の決め方

- **Context**: 正答率は 0〜1 の有界な値、出題回数は上限のない値で、キーワードの出題回数は配下の合計のため大きくなる
- **Findings**:
  - 正答率は10%刻みの固定10区間が読みやすく、範囲どうしの比較が容易。100% を最後の区間に含めないと「全問正解」だけの区間ができ、10区間の対称性が崩れる
  - 出題回数を固定幅で区切ると、設問（数回）とキーワード（数百回）の両方に合う幅がない。2倍ごとの区間（0、1、2〜3、4〜7、…）は両方で区間数が十数個以内に収まり、境界が固定のため比較もできる
  - PostgreSQL の `width_bucket(value, thresholds anyarray)` は、昇順の閾値配列に対し `thresholds[i] <= value` を満たす最大の `i` を返す。閾値 `1, 2, 4, …, 2^30` で2倍ごとの区間番号が整数演算だけで得られる
- **Implications**: 区間番号は、正答率が `-1`（未出題）と `0〜9`、出題回数が `0` 以上の整数。ラベルは区間番号から TS の純粋関数で作る

### チャートの表現

- **Context**: モバイル優先、ライト／ダーク両テーマ、支援技術への伝達、区間を選んで掘り下げる操作
- **Sources Consulted**: プロジェクトの UI 規約（`tech.md`）、一般的なアクセシブルなデータ可視化の実践（単色の量的表現、直接ラベル、色に頼らない値の提示、操作要素としての実ボタン）
- **Findings**:
  - 縦棒のヒストグラムは、390px 幅で11本以上の棒とラベルを並べるとラベルが重なる。横棒（1区間1行、左にラベル、右に件数）は行数が増えても縦スクロールだけで読め、各行をそのまま 44px のボタンにできる
  - 区間の量は単色（`--c-primary`）で表し、正誤色（赤・青）は「1回の解答の正誤」の意味を持つため使わない。`--c-warn` もエラーの意味のため使わない
  - 件数を数値で常に表示し、`aria-label` に区間の範囲・件数を、`aria-pressed` に選択状態を持たせれば、色や棒の長さに頼らずに読める
  - 描画は数十行の HTML 要素で足り、チャートライブラリは不要
- **Implications**: 新しい npm パッケージを追加しない。`Histogram` は横棒のボタンの列として作る

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| -------- | ------------- | ----------- | --------------------- | ------- |
| DB で区間ごとに数える RPC | ビューを読み、区間番号で `group by` した件数を返す | 返る行が少なく1,000行上限に無関係、件数が正確 | RPC が1つ増える | 採用 |
| 全件を取得してクライアントで数える | `fetchAllPages` で全行を取得し TS で集計 | RPC が不要 | 件数に比例して通信が増える。steering の「件数・集計は DB 側」に反する | 不採用 |
| チャートライブラリ（Recharts など） | SVG のヒストグラム | 見た目の自由度 | 依存追加、モバイルでのラベル重なり、ボタンとしての操作性を別途作る必要 | 不採用 |

## Design Decisions

### Decision: 区間から一覧への掘り下げを含める

- **Context**: brief は掘り下げの要否を設計で判断するとしている
- **Alternatives Considered**:
  1. 掘り下げなし — ヒストグラムだけを表示する
  2. 区間を選ぶと、同じ画面に該当する設問・キーワードの一覧を表示する
- **Selected Approach**: 2。一覧は弱い順（正答率の低い順、未出題が先頭）に並べ、設問の行から問題カタログの編集画面へ移れる
- **Rationale**: brief の問題は「どの問題・キーワードが弱いか」を把握できないことであり、分布だけでは「どれが」が分からない。区間への振り分けは DB 側の同じ関数で行うため、追加の複雑さは RPC 1つと一覧部品1つに収まる。product.md の品質フィードバックの循環（弱い問題を見直す）にもつながる
- **Trade-offs**: 画面と RPC が増える。一覧はモバイルで長くなるが、区間を選んだときだけ表示する
- **Follow-up**: 1,000 件を超える区間（大量データの未出題）で欠落がないことを E2E で確認する

### Decision: 区間への振り分けを SQL の不変関数1か所に置く

- **Context**: 区間の件数と一覧の件数を一致させる（4.3、5.5）。steering は「集計のビン分けを副作用のない関数として分離する」と定める
- **Alternatives Considered**:
  1. TS の純粋関数で振り分ける — 全件取得が必要になる
  2. SQL の `immutable` 関数 `stats_private.rate_bin`、`stats_private.count_bin` と、対象の定義 `stats_private.target_items` を2つの RPC から使う
- **Selected Approach**: 2。TS 側は区間番号からラベルと棒の長さを作る純粋関数だけを持つ
- **Rationale**: 振り分けが1か所に定義され、件数と一覧が定義上一致する。副作用のない関数として単体で SQL から検証できる
- **Trade-offs**: 区間の境界を変えるには migration が必要になる（Revalidation Trigger とする）

### Decision: 範囲選択はネイティブの select にする

- **Context**: quiz の `KeywordRangePicker` は下流が import してよい契約に含まれない。統計の範囲選択はモバイルで素早く選べればよい
- **Selected Approach**: 科目とキーワードを2つの `<select>` で選ぶ。キーワードは `buildKeywordTree` を深さ優先で平坦化し、深さに応じた字下げ付きの選択肢にする
- **Rationale**: モバイルの OS ネイティブの選択 UI が使え、キーボード操作と支援技術の対応が標準で得られる。1,200 件程度の選択肢でも動作する
- **Trade-offs**: 木の展開・折りたたみはできない。必要になれば quiz の部品を共通化する（`src/components` への移動は別の変更で行う）

### Decision: 問題が紐づかないキーワードを除外する

- **Context**: キーワードの集計で、配下を含めて出題対象の問題が0件のキーワードは、出題回数0・正答率なしとなり、分布の意味を持たない
- **Selected Approach**: `keyword_stats.question_count > 0` のキーワードだけを対象にする（3.5）
- **Rationale**: 作りかけの階層が「未出題」と「0回」の区間を膨らませ、弱点の把握を妨げるため

## Synthesis

- **Generalization**: 設問とキーワードの4つのヒストグラム（対象2 × 指標2）は「対象の行集合を区間番号で数える」同じ問題であり、対象（`question`／`keyword`）と指標（`correct_rate`／`attempt_count`）の組で引数化した1組の RPC と1つの `Histogram` 部品で扱う
- **Build vs. Adopt**: チャートライブラリは採用しない（上表）。全件取得は app-foundation の `fetchAllPages`、階層は subject-catalog の `keywordTree.ts`、集計値は quiz-session のビューを採用する
- **Simplification**: 区間の境界値を DB から返さず、区間番号だけを返して TS でラベルを作る。キャッシュや状態管理ライブラリは持たず、URL の検索パラメータと React state で足りる

## Consulted Skills

- `kiro-spec-design`、`kiro-spec-requirements`、`kiro-spec-tasks` の各 SKILL.md と規則
- データ可視化の指針（dataviz）: Skill の呼び出しは使えなかったため、単色の量的表現、直接ラベル、色に頼らない値の提示、テーマトークンへの統一という一般的な指針を適用した

## Risks & Mitigations

- 掘り下げの一覧を開く間に解答が記録され、区間の件数と一覧の件数がずれる — 一覧の取得時にヒストグラムも再取得し、同じ時点の値で表示する
- `keyword_stats` が部分木ごとに再帰計算するため、1,200 キーワードで遅くなる — quiz-session の性能方針（閉包テーブルの追加）に従い、本 spec は E2E で応答を確認するだけにする
- 区間の境界変更が過去の見え方を変える — 境界を Revalidation Trigger とし、変更時は SQL と TS のラベルを同時に更新する

## References

- [PostgreSQL: Mathematical Functions（width_bucket）](https://www.postgresql.org/docs/17/functions-math.html) — 閾値配列による区間番号の算出

# Brief: question-exchange

## Problem

問題は Claude が生成する。しかし、既存の学習対象・設問・品質フィードバックを Claude に渡し、生成結果を安全にアプリへ戻す経路がない。

## Current State

subject-catalog でスキーマの定義と手動編集だけができる。

## Desired Outcome

ユーザーが条件を指定して既存データを JSON で出力し、プロジェクトの skill を使って Claude に修正・新規作成用の JSON を作らせ、アプリでそれを検証・プレビューしてから取り込める。

## Approach

アプリ UI から JSON をダウンロード／アップロードする。交換フォーマットは本 spec が所有するバージョン付きの JSON スキーマとする。skill（`.claude/skills/` 配下）は出力された JSON を読み、問題作成ルールに従って取込用の JSON を書き出す。取込は単一トランザクションの RPC で行う。

## Scope

- **In**:
  - 出力条件の指定（科目、キーワードの部分木、フラグの有無・種類、正答率・出題回数などの統計条件）
  - 出力内容：キーワード階層、問題・選択肢・解説、未解消の問題フラグ、集計値（ヒントとして使う）
  - 取込用フォーマット：キーワードの追加・改名・移動、既存問題の修正、新規問題の作成、問題の無効化（無効化・削除の意味は subject-catalog の定義に従う）
  - 取込時の検証（JSON スキーマ、紐づけ先・移動先の存在、キーワード階層の循環禁止、subject-catalog の作問ルール検証関数）、差分プレビュー、原子的な適用
  - 適用時にプレビュー時点からの DB の変更（手動編集など）を検出したら、適用を中止する
  - 要件定義で決める項目：フラグを自動で解消する「修正」の範囲（解説だけの変更や無効化を含むか）、無効化された問題を出力に含めるか、既存問題の選択肢を削除・差し替えるときの扱い（履歴の扱いは subject-catalog の定義に従う）
  - 取込で修正された問題のフラグは、取込 RPC が quiz-session の SQL 関数を同じトランザクション内で呼んで解消済みにする
  - 問題生成 skill：出力 JSON を読み、`product.md` の「問題作成の原則」に従って取込用 JSON を書き出す。未解消のフラグを修正・新規作成のヒントとして使う
- **Out**: アプリからの LLM API 呼び出し、出題・統計画面、キーワードの削除（履歴や紐づけへの影響が大きいため手動編集のみ）。

## Boundary Candidates

- 交換用 JSON スキーマ（契約）
- 出力（条件による検索）
- 取込（検証・プレビュー・適用 RPC）
- 生成 skill とルール文書

## Out of Boundary

- フラグの入力 UI・テーブル・状態遷移（quiz-session）
- 集計の計算（quiz-session の集計ビューを参照するだけ）
- 問題の手動編集画面、作問ルールの検証関数、無効化・削除の定義（subject-catalog）

## Upstream / Downstream

- **Upstream**: subject-catalog（スキーマ、検証関数）、quiz-session（フラグ、集計ビュー、フラグ解消の SQL 関数）
- **Downstream**: なし

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: subject-catalog、quiz-session

## Constraints

UI は PC 優先（モバイル対応あり）。大量データでも欠落なく出力する（ページング）。skill 本体はテンプレートと同様に英語で書き、生成される問題の内容は日本語にする。

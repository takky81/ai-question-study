# Brief: learning-stats

## Problem

どの問題・キーワードが弱いか、どれだけ出題されたかを全体として把握できない。

## Current State

quiz-session が解答履歴を記録する。

## Desired Outcome

ユーザーがモバイルで、設問ごと・キーワードごとの正答率と出題回数の分布をヒストグラムで確認できる。

## Approach

問題ごと・キーワードごとの集計値は quiz-session の集計ビューを参照する。本 spec はそれをビンに分ける処理（DB 側）とヒストグラムの描画を担う。

## Scope

- **In**:
  - 設問ごとの正答率・出題回数のヒストグラム
  - キーワードごとの正答率・出題回数のヒストグラム（そのキーワードと配下の階層に紐づく問題すべてを集計する）
  - 科目・キーワード範囲による絞り込み
  - ビンから該当する設問・キーワードの一覧への掘り下げ（要否は設計で判断する）
- **Out**: 解答・出題のロジック、データの出力。

## Boundary Candidates

- ビン分けの RPC
- ヒストグラム UI

## Out of Boundary

- SRS 状態の更新、問題・キーワードごとの集計値の計算（quiz-session）

## Upstream / Downstream

- **Upstream**: quiz-session の集計ビュー、subject-catalog の階層
- **Downstream**: なし

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: quiz-session

## Constraints

UI は `tech.md` の規約（モバイル優先）に従う。全件を欠落なく扱う（1,000 行上限は DB 側の集計で回避する）。「わからない」「？」の数え方は quiz-session の集計ビューの定義に従う。

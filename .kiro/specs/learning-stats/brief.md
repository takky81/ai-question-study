# Brief: learning-stats

## Problem

どの問題・キーワードが弱いか、どれだけ出題されたかを全体として把握できない。

## Current State

quiz-session が解答履歴を記録する。

## Desired Outcome

ユーザーがモバイルで、設問ごと・キーワードごとの正答率と出題回数の分布をヒストグラムで確認できる。

## Approach

集計は DB 側（ビューまたは RPC）で行い、クライアントはビンに分けた結果をヒストグラムとして描画する。

## Scope

- **In**:
  - 設問ごとの正答率・出題回数のヒストグラム
  - キーワードごとの正答率・出題回数のヒストグラム（集計範囲を、そのキーワードに直接紐づく問題だけにするか、部分木を含めるかは設計で定義する）
  - 科目・キーワード範囲による絞り込み
  - ビンから該当する設問・キーワードの一覧への掘り下げ（要否は設計で判断する）
- **Out**: 解答・出題のロジック、データの出力。

## Boundary Candidates

- 集計 RPC
- ヒストグラム UI

## Out of Boundary

- SRS 状態の更新（quiz-session）

## Upstream / Downstream

- **Upstream**: quiz-session の解答履歴、subject-catalog の階層
- **Downstream**: question-exchange が同じ統計を出力条件に使う可能性がある

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: quiz-session

## Constraints

モバイル優先。全件を欠落なく集計する（1,000 行上限は DB 側の集計で回避する）。「わからない」は誤答として集計する。

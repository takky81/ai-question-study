# Brief: subject-catalog

## Problem

学習対象（科目内で階層化された概念・キーワード）と、それに紐づく選択問題を保持・閲覧・編集する仕組みがない。

## Current State

app-foundation の基盤だけがある。

## Desired Outcome

ユーザーが科目を作成し、キーワード階層と問題（問題文、選択肢、正解、問題と各選択肢の解説、紐づくキーワード）を PC 上で一覧・検索・編集できる。他の spec が利用する安定したスキーマが確定している。

## Approach

PostgreSQL に、科目・キーワードノード（親子の木構造）・問題・選択肢・問題とキーワードの紐づけを owner_id + RLS 付きで定義する。管理画面は PC 優先（モバイル対応あり）で実装する。

## Scope

- **In**:
  - 科目の CRUD
  - キーワード階層（任意の深さの木）の CRUD・並べ替え・移動
  - 問題は階層の葉にも途中のノードにも紐づけられる（横断的な問題）
  - 問題の種別（キーワードを答える問題／キーワードの特徴などを答える問題）
  - 選択肢（正解は 1 つ）、問題全体の解説、各選択肢の解説
  - 問題の一覧・絞り込み・手動編集・削除
  - キーワードの階層パス（祖先込み）を取得する共通関数
- **Out**: 出題・解答履歴、JSON 入出力、統計。「わからない」選択肢は固定 UI なのでデータとして持たない。

## Boundary Candidates

- 階層キーワードモデル
- 問題・選択肢・解説モデル
- 管理画面

## Out of Boundary

- フラグ・SRS 状態・解答履歴（quiz-session が所有）
- 一括取込（question-exchange が所有）

## Upstream / Downstream

- **Upstream**: app-foundation
- **Downstream**: question-exchange、quiz-session、learning-stats

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: question-exchange（取込で同じスキーマへ書き込む）

## Constraints

問題・選択肢は安定した ID を持ち、取込時に既存問題の更新と新規作成を区別できるようにする。キーワードを削除したときの問題の紐づけの扱いを定義する。

# Roadmap

## Overview

選択問題に解答して学習するアプリを作る。科目ごとに階層化された学習対象（概念・キーワード）を持ち、問題は階層の任意のノードに紐づく。葉だけでなく途中の階層にも紐づけられ、横断的な問題を想定している。問題はこのプロジェクトの Claude skill が生成する。アプリから条件付きで出力した既存の学習対象・設問・フラグ・統計を入力として、修正・新規作成用の JSON を作成し、アプリに取り込む。

出題は SRS（間隔反復）で管理し、未出題 → 定着率が低い順に出題する。

## Approach Decision

- **Chosen**: クライアント SPA + Supabase 構成。問題の入出力はアプリ UI からの JSON ダウンロード／アップロードで行う。生成は Claude skill がローカルのファイルを読み書きして行う。
- **Why**: RLS・RPC・ページング・正誤色トークン・テスト体制を `tech.md` の規約として最初から適用できる。専用サーバーや service_role キーが不要で、skill は DB 認証情報に触れない。
- **Rejected alternatives**: skill から CLI で Supabase を直接読み書きする方式（鍵管理が必要になり、取込時の検証・プレビューを UI で行えない）。定着率を累積／直近重み付けの正答率で定義する方式（ユーザーが SRS を選択した）。

## Scope

- **In**: 認証（自分専用アカウント）、科目・階層キーワード・問題・選択肢・解説の管理、条件付き出力と取込、問題生成 skill、SRS による出題、解答画面、設問別・キーワード別のヒストグラム統計。
- **Out**: アプリ内からの LLM API 直接呼び出し、記述式など選択問題以外の形式、複数ユーザー間での問題共有、アカウントの公開登録。

## Constraints

- 技術・実装標準・UI の規約は `tech.md`、問題作成の原則とフラグの定義は `product.md` を正本とし、spec では再定義せず参照する。

## Boundary Strategy

- **Why this split**: データ定義（catalog）を中心に置き、学習（quiz）がその上で解答履歴・SRS・フラグを持つ。取込・出力（exchange）と統計（stats）は、catalog と quiz のデータを参照する下流として並行して開発できる。
- **Shared seams to watch**:
  - 問題・選択肢・解説・キーワードと紐づけのスキーマ、問題の無効化と削除時の履歴の扱い（catalog が所有し、exchange と quiz が利用）。問題・選択肢・キーワードは、移動・改名しても変わらない安定 ID を持つ
  - 問題作成ルールの検証関数（catalog が TS の純粋関数として所有し、手動編集と取込の両方でクライアント側で使う。DB 側は制約で最低限を担保する）
  - 問題フラグのテーブルと状態（未解消／解消済み）（quiz が所有）。exchange は出力で参照し、取込で修正した問題のフラグは、quiz が公開する SQL 関数を exchange の取込 RPC が同じトランザクション内で呼んで解消済みにする
  - 解答履歴・SRS 状態・定着率（quiz が所有）。定着率は出題順に使う1つの数値として外部に公開する
  - 問題ごと・キーワードごとの集計（正答数・出題数・正答率）（quiz が DB ビューとして所有し、stats と exchange が参照）。キーワードの集計範囲は、そのキーワードと配下の階層に紐づく問題すべてとする
  - JSON 交換フォーマット（exchange が所有。生成 skill と取込処理の間の契約）

## Specs (dependency order)

- [x] app-foundation -- プロジェクト雛形、Supabase 接続・認証、共通レイアウト・テーマ・正誤色トークン。Dependencies: none
- [x] subject-catalog -- 科目・階層キーワード・問題・選択肢・解説のスキーマ、作問ルールの検証、管理画面。Dependencies: app-foundation
- [x] quiz-session -- 出題導線、SRS による出題順、解答・正誤表示・解説・フラグ、解答の集計ビュー。Dependencies: subject-catalog
- [x] question-exchange -- 条件付き出力、生成 skill、JSON 取込。Dependencies: subject-catalog, quiz-session
- [x] learning-stats -- 設問別・キーワード別の正答率と出題回数のヒストグラム。Dependencies: subject-catalog, quiz-session

# Roadmap

## Overview

選択問題に解答して学習するアプリを作る。科目ごとに階層化された学習対象（概念・キーワード）を持ち、問題は階層の任意のノードに紐づく。葉だけでなく途中の階層にも紐づけられ、横断的な問題を想定している。問題はこのプロジェクトの Claude skill が生成する。アプリから条件付きで出力した既存の学習対象・設問・フラグ・統計を入力として、修正・新規作成用の JSON を作成し、アプリに取り込む。

技術スタックは `../blank-study` と同一（React 19 + Vite 7 + TypeScript + Tailwind CSS 4 の SPA、Supabase Auth/PostgreSQL/RLS/RPC、GitHub Pages 配信）。出題は SRS（間隔反復）で管理し、未出題 → 定着率が低い順に出題する。

## Approach Decision

- **Chosen**: blank-study と同じクライアント SPA + Supabase 構成。問題の入出力はアプリ UI からの JSON ダウンロード／アップロードで行う。生成は Claude skill がローカルのファイルを読み書きして行う。
- **Why**: 既存プロジェクトの規約・知見（RLS、RPC、ページング、正誤色トークン、テスト体制）をそのまま流用できる。専用サーバーや service_role キーが不要で、skill は DB 認証情報に触れない。
- **Rejected alternatives**: skill から CLI で Supabase を直接読み書きする方式（鍵管理が必要になり、取込時の検証・プレビューを UI で行えない）。定着率を累積／直近重み付けの正答率で定義する方式（ユーザーが SRS を選択した）。

## Scope

- **In**: 認証、科目・階層キーワード・問題・選択肢・解説の管理、条件付き出力と取込、問題生成 skill、SRS による出題、解答画面（選択と正誤の同時表示、解説、フラグ、「？」エリア、「わからない」）、設問別・キーワード別のヒストグラム統計。
- **Out**: アプリ内からの LLM API 直接呼び出し、記述式など選択問題以外の形式、複数ユーザー間での問題共有。

## Constraints

- 技術・実装標準・セキュリティ・テスト方針は `../blank-study/.kiro/steering/tech.md` に準拠する（owner_id + RLS、SECURITY INVOKER RPC、1,000 行上限を前提としたページング、正誤色は正解=赤／不正解=青のトークンで統一）。
- 解答画面、解答画面までの導線、統計画面はモバイル UI 優先。それ以外（管理・入出力）は PC 優先とし、モバイルにも対応する。

## Boundary Strategy

- **Why this split**: データ定義（catalog）を中心に置き、取込・出力（exchange）と学習（quiz）を並行して開発できるようにする。統計（stats）は解答履歴に依存する下流として分離する。
- **Shared seams to watch**:
  - 問題・選択肢・解説・キーワード紐づけのスキーマ（catalog が所有し、exchange と quiz が利用）
  - 問題フラグのスキーマ（quiz が書き込み、exchange が出力）
  - 解答履歴・SRS 状態（quiz が所有し、stats と exchange が参照）
  - JSON 交換フォーマット（exchange が所有。生成 skill と取込処理の間の契約）

## Specs (dependency order)

- [ ] app-foundation -- プロジェクト雛形、Supabase 接続・認証、共通レイアウト・テーマ・正誤色トークン。Dependencies: none
- [ ] subject-catalog -- 科目・階層キーワード・問題・選択肢・解説のスキーマと管理画面。Dependencies: app-foundation
- [ ] question-exchange -- 条件付き出力、生成 skill と問題作成ルール、JSON 取込。Dependencies: subject-catalog
- [ ] quiz-session -- 出題導線、SRS による出題順、解答・正誤表示・解説・フラグ。Dependencies: subject-catalog
- [ ] learning-stats -- 設問別・キーワード別の正答率と出題回数のヒストグラム。Dependencies: quiz-session

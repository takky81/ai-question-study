# Brief: app-foundation

## Problem

後続の全機能が共通で必要とする実行基盤（ビルド、配信、認証、DB 接続、レイアウト）がまだない。

## Current State

greenfield で、cc-sdd の設定だけがある。参照実装として `../blank-study` がある。

## Desired Outcome

ログインしたユーザーが空のホーム画面に到達できる。後続の feature は `src/features/<domain>/` に追加するだけで画面・API を実装できる。

## Approach

blank-study の構成（Vite + React Router + Tailwind 4 + Supabase JS、GitHub Pages、ローカル Supabase、Vitest/Playwright）を踏襲して雛形を作る。steering（product/tech/structure）も整備する。

## Scope

- **In**: package/tsconfig/vite の設定、Router と base/basename の同期、Supabase client、認証（ログイン／ログアウト／保護ルート）、共通レイアウト・ナビゲーション（学習導線はモバイル優先、管理導線は PC 優先）、テーマ・CSS トークン（正誤色を含む）、共通ページングユーティリティ、テスト・CI・デプロイ設定。
- **Out**: 業務テーブル（科目・問題など）、各業務画面。

## Boundary Candidates

- ビルド／配信／CI
- 認証とセッション
- 共通 UI・テーマトークン

## Out of Boundary

- 学習ドメインのスキーマと画面

## Upstream / Downstream

- **Upstream**: blank-study の規約、Supabase Cloud、GitHub Pages
- **Downstream**: 全 spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: なし

## Constraints

blank-study の tech.md に準拠する。秘密情報を `VITE_` 変数に置かない。

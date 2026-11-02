# Brief: app-foundation

## Problem

後続の全機能が共通で必要とする実行基盤（ビルド、配信、認証、DB 接続、レイアウト）がまだない。

## Current State

greenfield で、cc-sdd の設定と steering だけがある。

## Desired Outcome

ログインしたユーザーが空のホーム画面に到達できる。後続の feature は `src/features/<domain>/` に追加するだけで画面・API を実装できる。

## Approach

steering（tech.md、structure.md）に定めた構成（Vite + React Router + Tailwind 4 + Supabase JS、GitHub Pages、ローカル Supabase、Vitest/Playwright）で雛形を作る。

## Scope

- **In**: package/tsconfig/vite の設定、Router と base/basename の同期、Supabase client、認証（ログイン／ログアウト／保護ルート。新規登録は Supabase 側で無効にし、自分専用アカウントだけが使える）、共通レイアウト・ナビゲーション（学習導線はモバイル優先、管理導線は PC 優先）、テーマ・CSS トークン（正誤色を含む）、共通ページングユーティリティ、テスト・CI・デプロイ設定。
- **Out**: 業務テーブル（科目・問題など）、各業務画面。

## Boundary Candidates

- ビルド／配信／CI
- 認証とセッション
- 共通 UI・テーマトークン

## Out of Boundary

- 学習ドメインのスキーマと画面

## Upstream / Downstream

- **Upstream**: steering の規約、Supabase Cloud、GitHub Pages
- **Downstream**: 全 spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: なし

## Constraints

tech.md に準拠する。秘密情報を `VITE_` 変数に置かない。

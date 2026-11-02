# プロジェクト構造

## 組織方針

feature-first と共通ユーティリティの組み合わせを採用する。画面、業務フロー、データアクセス、機能固有のロジックは同じ feature にまとめる。複数の feature で安定して共有する UI と純粋ロジックだけを共通領域に置く。feature はおおむね roadmap の spec 境界（catalog、exchange、quiz、stats）に対応させる。

## ディレクトリパターン

### Feature

**場所**: `src/features/<domain>/`
**目的**: 業務領域ごとの画面、API、純粋ロジック、機能固有のコンポーネント
**パターン**:

- `<Domain>Page.tsx`: ルート画面。状態と利用者操作のオーケストレーションを担う
- `api.ts`: Supabase の呼び出しと、DB 行とアプリ型の変換
- 小文字の役割名の `.ts`（例: `order.ts`、`srs.ts`、`validate.ts`）: 検証、パース、計算、順序付けなどの純粋ロジック
- 純粋ロジックのテストは同じディレクトリに `<module>.test.ts` として置く

### 共通 UI

**場所**: `src/components/`
**目的**: 複数画面で再利用する表示・レイアウト部品
**制約**: 原則として自分で業務データを取得せず、props と context で受け取る。

### 共通基盤と純粋ロジック

**場所**: `src/lib/`
**目的**: feature を横断する値の変換、テーマ、ページング、Supabase client、キーワード階層パスなどの共有契約
**基準**: 1つの feature でしか使わないものは、その feature に置く。複数の feature が同じ契約で使うようになった段階で共通化する。

### 永続化

**場所**: `supabase/migrations/`
**目的**: スキーマ、制約、index、RLS、RPC、権限
**規則**: `YYYYMMDDHHMMSS_description.sql` を追加し、適用済みの migration は書き換えない。

### 問題生成

**場所**: `.claude/skills/<skill名>/`（生成 skill）、`src/features/exchange/`（交換用 JSON スキーマの型とスキーマ検証。作問ルールの検証は catalog の関数を使う）
**規則**: 交換フォーマットの型は exchange の feature が所有する。skill はその契約と、product.md の問題作成の原則に従って JSON を出力する。出力・生成したデータファイルはソースとして扱わず、コミットしない。

### 検証資産

- `e2e/`: Playwright による利用者経路と DB 統合のテスト
- `.kiro/specs/`: 要件、技術設計、実装タスクの正式な機能仕様

## 依存方向

```text
App / Page
  -> feature component / pure logic / api.ts
      -> shared component / src/lib / Supabase
          -> PostgreSQL schema and RPC
```

- 同じ feature 内は相対 import、別ディレクトリは `@/` alias を使う
- barrel file は作らず、責務を持つ具体的なファイルから named export を import する
- feature 間の参照は既存の契約を再利用する場合に限って許容し、循環依存は作らない
- Page や共通 UI から DB へ直接アクセスせず、feature の API 境界を通す

## 命名規約

- **ディレクトリ**: 小文字の業務名
- **React コンポーネント**: `PascalCase.tsx`。export 名も PascalCase
- **ページ**: `<Domain>Page.tsx`
- **非 UI モジュール**: 小文字または camelCase の役割名
- **関数・変数**: camelCase
- **型**: PascalCase。`type` を基本とする
- **定数**: UPPER_SNAKE_CASE
- **React hook**: `use...`
- **DB／SQL**: snake_case
- **テスト**: `<module>.test.ts`、E2E は `<domain>.spec.ts`
- **export**: named export を基本とし、default export は設定ファイルなどフレームワークが要求する箇所に限る

## Import 例

```typescript
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import type { QuestionRow } from './api';
import { pickNextQuestion } from './order';
```

外部パッケージ、`@/` の絶対 import、同じ feature の相対 import の順を基本とする。型の import は明示する。

## 変更単位

- 新機能は、責務の明確な既存 spec を拡張するか、新しい境界の spec を先に作る
- 1つの変更の中で、承認済みの spec、コード、テストの対応を保つ
- 複数の spec を横断する変更（スキーマ、フラグ、交換フォーマット）は、上流の契約を先に更新し、下流を再検証する
- 生成物（`dist/`、`test-results/`、出力・生成した JSON）をソース構造として扱わない

---
_新しいコードが既存のパターンに従う限り、この文書を更新しなくてよい粒度を保つ。_

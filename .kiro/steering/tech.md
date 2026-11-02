# 技術スタック

## アーキテクチャ

React のクライアント側 SPA が Supabase Auth、PostgREST、RPC を直接利用する。画面は GitHub Pages に静的に配信し、認証・永続化・集計・トランザクションは Supabase/PostgreSQL が担う。専用のアプリサーバーは持たない。

問題生成は Claude Code の skill がローカルの JSON ファイルを読み書きして行う。アプリは LLM API を呼ばない。アプリとの受け渡しは、UI からの JSON ダウンロード／アップロードに限る。

## コア技術

- **言語**: TypeScript 5.9、ESM、ES2022
- **実行環境**: Node.js 24 系、ブラウザ
- **フロントエンド**: React 19、React Router 7、Vite 7
- **UI**: Tailwind CSS 4、CSS カスタムプロパティ、lucide-react
- **データ／認証**: Supabase JS 2、PostgreSQL 17、Supabase Auth
- **テスト**: Vitest 3、Testing Library、Playwright
- **配信**: GitHub Actions、GitHub Pages、Supabase Cloud

## 実装標準

### 型安全

- `strict`、`noUncheckedIndexedAccess`、未使用検査を維持し、`any` を導入しない
- 型だけの import には `import type` または `type` 修飾を使う
- DB の `snake_case` の行は、feature の API 境界で `camelCase` のアプリ型へ変換する
- スキーマを変更するときは、API 型、マッピング、テストを同時に更新する

### 状態とドメインロジック

- 画面固有の状態は React state に置き、横断的な状態は最小限にする
- 出題順、SRS の更新計算、集計のビン分け、交換用 JSON の検証・差分計算は、副作用のない関数として分離する
- DB 操作は feature の `api.ts` に集約する。失敗は操作の文脈を含む日本語の `Error` として返す
- 互いに独立した読み取りや更新は、安全な場合に `Promise.all` で並列化する
- 二重送信の防止、楽観更新のロールバック、再試行できるエラー表示を一貫させる

### データとセキュリティ

- すべてのユーザーデータは `owner_id` を持つ。RLS の `USING` と `WITH CHECK` の両方で `auth.uid()` に制限する
- ブラウザには公開前提の publishable/anon key だけを渡す。`service_role` はフロントや Actions に置かない
- RPC は原則として `SECURITY INVOKER` とし、`search_path = ''` とスキーマ修飾を使う
- 他の RPC の内部からだけ呼ぶ SQL 関数は、クライアントから直接呼べないようにする（公開スキーマの外に置くか、`EXECUTE` 権限を与えない）
- 解答の記録と SRS の更新、JSON の取り込みなど、複数テーブルの原子的な更新は PostgreSQL RPC の単一トランザクションで行う
- 既存のマイグレーションは変更せず、新しいタイムスタンプ付きマイグレーションを追加する
- 後戻りしにくいスキーマ変更（列の削除・改名など）は、追加 → 併用 → 削除の互換期間を設ける

### 交換用 JSON

- フォーマットはバージョン付きのスキーマとし、出力と取り込みで同じ型定義を共有する
- 既存の問題・選択肢・キーワードは安定した ID で参照し、新規作成は ID なしで区別する。同じファイル内の新規要素どうし（新規キーワードに紐づく新規問題など）は、ファイル内だけで有効な一時キーで参照する
- 取り込みは「検証 → 差分プレビュー → 適用」の順で行い、不正なファイルは一部だけ適用することをしない

### 件数と性能

- Supabase の1回あたり1,000行の上限を前提にする。件数・集計は DB 側で行う
- 全行が必要な処理は共通ページングで取得し切る。安定した一意の順序（例: 作成日時 + ID）で1,000件ずつ取得し、行の欠けや重複を防ぐ
- 問い合わせのパターンに合わせて B-tree / GIN の index を設ける
- 大量データへの対応は「エラーにならない」ではなく「欠落しない」ことをテストする

### UI

- 解答画面、解答画面までの導線、統計画面はモバイル優先。管理・入出力画面は PC 優先でモバイルにも対応する
- 色と共通部品の見た目は CSS トークン／共通 class に集約する
- 正誤の色は全画面で統一する（正解は赤 `--c-correct`、不正解は青 `--c-incorrect`）。エラー・危険操作用の `--c-warn` を正誤表示に使わない
- 選択状態と正誤状態は独立した表現（枠・印・色など）で示し、1つの選択肢内で同時に表示できるようにする
- キーボード focus、44px 相当の操作領域、ライト／ダーク両テーマでのコントラストを維持する

## テストと品質ゲート

- 純粋ロジックは対象モジュールの隣に Vitest を置く
- 利用者の操作経路、RLS、DB の副作用、レスポンシブ UI は Playwright とローカル Supabase で検証する。本番 DB には接続しない
- E2E は共有のローカル DB を使うため、直列に実行する
- 振る舞いを変えるときは、cc-sdd の仕様、実装、ユニット／E2E テストを同期する
- 通常の品質ゲートは型検査、ユニットテスト、production build。画面・DB・振る舞いを変えたときは E2E も必須にする
- CI（GitHub Actions）では、push と PR ごとに品質ゲートを実行する。main への反映後、別のワークフローで GitHub Pages にデプロイする

## 開発環境

```bash
npm ci
npm run db:start
npm run dev
npm run typecheck
npm test
npm run build
npm run test:e2e
```

ローカル DB には Docker が必要。Supabase CLI は devDependency としてバージョンを固定し、`db:*` の npm script から使う。

ビルド設定:

- Vite の `base` は、build 時は `/<リポジトリ名>/`、開発時は `/` にする。Router の `basename` は常にこれと同期し、GitHub Pages のサブパス配信を保つ
- `@` alias は `src/` を指す（tsconfig と Vite の両方で設定する）
- Vitest は jsdom 環境で、共通の setup ファイル（`src/test/setup.ts`）から Testing Library の matcher を読み込む

環境変数は `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` を使う。`VITE_` 変数は成果物に埋め込まれるため、秘密情報を置かない。

---
_採用技術と変更時の判断基準を記録し、依存パッケージの網羅表にはしない。_

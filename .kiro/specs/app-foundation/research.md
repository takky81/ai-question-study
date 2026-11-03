# Research & Design Decisions

## Summary

- **Feature**: `app-foundation`
- **Discovery Scope**: New Feature（greenfield。既存コードなし）
- **Key Findings**:
  - GitHub Pages は SPA のフォールバックを持たないため、深いリンクの直接表示と再読み込み（要件 2.3）には、ビルド成果物の `index.html` を `404.html` として複製する方式が最小で確実である。
  - Supabase Auth のセッションはブラウザのストレージに保存され、`onAuthStateChange` が他タブでのログアウト・トークン失効も通知する。セッション状態は1つの Provider で購読すれば要件 3.6・4.4 を満たせる。
  - 公開登録の無効化は Supabase 側の設定（ローカルは `supabase/config.toml` の `enable_signup = false`、Cloud はダッシュボードの Auth 設定）で行い、クライアントは登録 API を呼ばない。

## Research Log

### サブパス配信と Router の同期

- **Context**: 要件 2.1〜2.3。GitHub Pages はリポジトリ名のサブパスで配信される。
- **Sources Consulted**: Vite の `base` オプションと `import.meta.env.BASE_URL`、React Router 7 の `createBrowserRouter` の `basename`、GitHub Pages の 404.html の挙動。
- **Findings**:
  - Vite は `base` を `import.meta.env.BASE_URL` として公開する。Router の `basename` にこの値を渡せば、両者は常に同期する。
  - GitHub Pages は存在しないパスに対して `404.html` を返す。`index.html` と同じ内容にすれば SPA が起動し、Router が URL を解決する（HTTP ステータスは 404 だが、個人用途では許容できる）。
- **Implications**: `vite.config.ts` で `command === 'build'` のとき `/<リポジトリ名>/` を設定し、`basename` は `BASE_URL` から導出する。ビルド後に `404.html` を生成するスクリプトを置く。

### 認証と登録の無効化

- **Context**: 要件 3、4。自分専用アカウントのみ。
- **Sources Consulted**: Supabase JS 2 の `auth.signInWithPassword`、`auth.signOut`、`auth.getSession`、`auth.onAuthStateChange`。Supabase CLI の `config.toml`（`[auth] enable_signup`）。
- **Findings**:
  - `getSession` は保存済みセッションを復元し、期限切れなら更新を試みる。`onAuthStateChange` は `SIGNED_OUT` を他タブでも発火する。
  - 登録を無効にすると `auth.signUp` はエラーを返し、アカウントは作られない。
  - ローカルの所有者アカウントは `supabase/seed.sql` で `auth.users` と `auth.identities` に挿入して用意できる。
- **Implications**: `AuthProvider` が状態（`loading` / `signedIn` / `signedOut`）を一元管理する。E2E は seed の所有者アカウントを使う。

### 1,000 行上限とページング

- **Context**: 要件 7。tech.md の件数規約。
- **Findings**: PostgREST は `range(from, to)` で範囲取得でき、Supabase の既定上限は 1,000 行。安定順序は呼び出し側が `order` で指定する必要がある。
- **Implications**: ページングはクエリ生成関数を受け取る汎用関数にし、順序指定の責任を呼び出し側に置く。業務テーブルを持たないため、本 spec では偽のページ取得関数でユニットテストする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| -------- | ------------- | ----------- | --------------------- | ------- |
| ルート登録表（採用） | feature がルート定義と導線メタデータを1つの配列に追加する | 追加箇所が1つ。導線の表示有無がルートの存在から決まる | 表が肥大化したら分割が必要 | 要件 1.4、5.6 |
| ファイルベースルーティング | ディレクトリ構造からルートを生成 | 追加作業がさらに少ない | 追加プラグインが必要。steering の構成に無い | 不採用 |
| HashRouter | `#` 付き URL で 404 問題を回避 | 404.html 不要 | URL が不自然。basename 同期の規約と合わない | 不採用 |

## Design Decisions

### Decision: 導線をルート登録表から生成する

- **Context**: 要件 1.4、5.2、5.6。後続 feature の追加を1箇所に限定したい。
- **Alternatives Considered**:
  1. レイアウトにナビゲーション項目を直書きする
  2. ルート定義に導線メタデータ（表示名、区分、アイコン）を持たせる
- **Selected Approach**: 2。`src/app/routes.tsx` の `APP_ROUTES` に `nav` 付きで追加すると、導線が自動で表示される。
- **Rationale**: 未実装画面の導線を出さない要件 5.6 を構造的に満たす（一般化: 導線はルートの射影）。
- **Trade-offs**: ルート表が feature の Page を import するため、ルート表は feature より上位の層に置く。

### Decision: ページングは自作の小さな関数にする

- **Context**: 要件 7。
- **Alternatives Considered**: 外部のページングライブラリ／Supabase 側の RPC で一括取得。
- **Selected Approach**: `fetchAllPages` を自作する（20 行程度）。
- **Rationale**: 既存ライブラリは Supabase の `range` に特化しておらず、依存を増やす利点がない（Build vs. Adopt）。

### Decision: テーマは CSS カスタムプロパティ + `prefers-color-scheme`

- **Context**: 要件 6.1〜6.4。
- **Selected Approach**: `src/index.css` の `:root` にトークンを定義し、ダークは `@media (prefers-color-scheme: dark)` で上書きする。Tailwind 4 の `@theme inline` でトークンをユーティリティ class として公開する。手動切替は持たない（Simplification: 要件は端末設定への追従のみ）。

### Simplification

- 状態管理ライブラリは導入しない（認証状態のみが横断状態）。
- ホーム画面は空の Page とし、ダッシュボード部品は作らない。

## Risks & Mitigations

- Supabase Cloud で登録無効化を設定し忘れる — デプロイ手順に確認項目を記載し、E2E で登録不可をローカルで検証する。Cloud 側は運用確認とする。
- 404.html 方式でクローラや監視が 404 を記録する — 個人用途のため許容し、research に記録する。
- リポジトリ名の変更で `base` がずれる — `GITHUB_REPOSITORY` 環境変数から導出し、未設定時は既定値を使う。

## References

- Vite 公式ドキュメント「Shared Options: base」「Env Variables and Modes」
- React Router 公式ドキュメント「createBrowserRouter」
- Supabase 公式ドキュメント「Auth: signInWithPassword / onAuthStateChange」「CLI config: auth.enable_signup」
- GitHub Docs「Creating a custom 404 page for your GitHub Pages site」「Using custom workflows with GitHub Pages」

# エージェント型SDLCと仕様駆動開発

エージェント型SDLC上での Kiro スタイル仕様駆動開発（Spec-Driven Development）

## プロジェクトコンテキスト

### パス

- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering と Specification の違い

**Steering**（`.kiro/steering/`）- プロジェクト全体のルールとコンテキストで AI を導く
**Specs**（`.kiro/specs/`）- 個々の機能の開発プロセスを形式化する

### 進行中の仕様

- 進行中の仕様は `.kiro/specs/` を確認する
- 進捗確認には `/kiro-spec-status [feature-name]` を使う

## 開発ガイドライン

- 思考は英語で行い、ユーザーへの応答は日本語で行う。
- プロジェクトファイルに書き出す Markdown（requirements.md、design.md、tasks.md、research.md、検証レポート、steering 文書など）はすべて日本語で書く（spec.json.language を参照）。
  - テンプレートの見出し構造（`Requirement 1:`、`Acceptance Criteria` など）や EARS のキーワード（When / If / While / Where / shall）は英語のままでよいが、本文・説明・要件の中身は日本語で書く。
- skill（`.claude/skills/`）やテンプレート（`.kiro/settings/templates/`）自体は英語のままとし、翻訳しない。

## 最小ワークフロー

- Phase 0（任意）: `/kiro-steering`、`/kiro-steering-custom`
- Discovery: `/kiro-discovery "アイデア"` — 進め方を判断し、複数仕様のプロジェクトでは brief.md と roadmap.md を作成する
- Phase 1（仕様策定）:
  - 単一仕様: `/kiro-spec-quick {feature} [--auto]`、または段階的に:
    - `/kiro-spec-init "説明"`
    - `/kiro-spec-requirements {feature}`
    - `/kiro-validate-gap {feature}`（任意: 既存コードベースがある場合）
    - `/kiro-spec-design {feature} [-y]`
    - `/kiro-validate-design {feature}`（任意: 設計レビュー）
    - `/kiro-spec-tasks {feature} [-y]`
  - 複数仕様: `/kiro-spec-batch` — roadmap.md のすべての仕様を依存関係のウェーブごとに並列で作成する
- Phase 2（実装）: `/kiro-impl {feature} [tasks] [--review required|inline|off]`
  - タスク番号なし: 自律モード（タスクごとにサブエージェント＋独立レビュー＋最終検証）
  - タスク番号あり: 手動モード（選択したタスクをメインコンテキストで実行。完了前のレビューは必須）
  - `--review off` はタスク単位のレビューを省略する。意図的な場合のみ使い、最終品質ゲートとして `/kiro-validate-impl {feature}` を必ず実行する
  - `/kiro-validate-impl {feature}`（単独での再検証）
- 進捗確認: `/kiro-spec-status {feature}`（いつでも使用可）

## Skill の構成

Skill は `.claude/skills/kiro-*/SKILL.md` にある

- 各 skill は `SKILL.md` を持つディレクトリ
- Skill は会話コンテキストにアクセスしながらインラインで実行される
- 効率化のため、並列の調査をサブエージェントに委任することがある
- 追加ファイル（テンプレート、例）を skill ディレクトリに置ける
- `kiro-review` — レビュー担当サブエージェントが使う、タスク単位の批判的レビュー手順
- `kiro-debug` — デバッグ担当サブエージェントが使う、根本原因優先のデバッグ手順
- `kiro-verify-completion` — 成功・完了を宣言する前に、新しい証拠で確認するゲート
- ユーザーが明示的に求めた skill と、タスクの領域（設計、アクセシビリティ、UX を含む）に関連する skill を使う。
- まず説明やメタデータから skill を選び、選んだ skill とタスクに必要な参照だけを読む。
- ホストとプロジェクトの明示的なルールに従い、必要なワークフローのチェックは省かない。タスクが小さいという理由で関連 skill を飛ばさない。

## 開発ルール

- 3フェーズ承認ワークフロー: 要件 → 設計 → タスク → 実装
- 各フェーズで人間のレビューが必要。`-y` は意図的に早く進める場合のみ使う
- steering を最新に保ち、`/kiro-spec-status` で整合性を確認する
- ユーザーの指示に正確に従い、その範囲内では自律的に動く。必要なコンテキストを集め、依頼された作業をこの実行内で最後までやり切る。質問は、必要な情報が欠けているか指示がひどく曖昧な場合に限る。

## Steering の設定

- 仕様策定と実装の作業では、`.kiro/steering/` の以下のコアファイルを読み込む。内容が変わっていないファイルは読み直さず、今のコンテキストを再利用する。
- 追加の steering は、プロジェクトのルールで必要な場合か、タスクに関係する場合だけ読み込む。
- デフォルトファイル: `product.md`、`tech.md`、`structure.md`
- カスタムファイルも使える（`/kiro-steering-custom` で管理）

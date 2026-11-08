# Implementation Plan

- [x] 1. 基盤: 出力・取込の DB 関数とフォーマットの正本

- [x] 1.1 出力対象の絞り込みと出力用の RPC を作る
  - クライアントに公開しない内部用スキーマを作り、認証済みロールに利用と実行の権限だけを与える
  - 科目、キーワードの部分木（上流の部分木関数を使用）、未解消フラグの有無・種類、正答率・出題数・未出題の条件、無効の問題を含めるかを AND で適用し、削除済みを常に除いて対象の問題 ID を返す内部関数を作る
  - 内部関数を使い、問題（紐づけと問題ごとの集計値を含む）、有効な選択肢、未解消のフラグを、それぞれ一意で安定した順序で返す3つの RPC を作る。呼び出し元の権限で動き、匿名と public から実行権限を取り消す
  - ローカル DB で、途中のキーワードの範囲では配下の問題だけ、既定では無効の問題なし、外された選択肢と解消済みのフラグなしの結果が SQL で返る
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 10.7_

- [x] 1.2 取込を原子的に適用する RPC を作る
  - 先頭で、期待する状態として渡されたキーワード・問題の行を固定し、更新日時の不一致・消失・削除済みがあれば `stale_preview` で何も反映せず中止する
  - キーワードの追加（親が先の順、一時キーの解決）、退避名を経由する2段階の改名、上流の移動 RPC による移動を行う
  - 上流の問題保存 RPC で修正（ID 不変）と新規作成（新しい ID を一時キーに対応づけ）を、上流の無効化 RPC で無効化を行う
  - 修正された問題の ID だけを quiz-session のフラグ解消の内部関数に渡し、フラグのテーブルへは直接書き込まない。新規 ID の対応、操作ごとの件数、解消件数を返す
  - SQL で、全操作を含むペイロードが1回で反映され、途中の操作で上流の例外を起こすとキーワード追加とフラグ解消も含めて何も残らない
  - _Depends: 1.1_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.2, 8.1, 8.4, 8.5, 10.7_

- [x] 1.3 交換フォーマットの型と読み込み検証を作る
  - 出力用・取込用のフォーマット識別子とバージョン、キーワード参照（既存 ID または一時キー）、出力ファイルと取込ファイルの型を、上流の問題種別とフラグ識別子の型を使って定義する。削除・有効化の操作は型に持たない
  - 取込ファイルの文字列を読み、壊れた JSON・種類違い・対応外のバージョンはそれだけを返し、それ以外は必須欠落・型違い・未知の項目や操作を、何番目のどの要素のどの項目かの位置付きですべて返す検証関数を作る。省略された配列は空に正規化する
  - 出力ファイルを読む検証関数も同じ規則で作る
  - ユニットテストで、各種の不正なファイルが位置付きの問題一覧になり、正しいファイルが型付きの値として返る
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 4.2, 4.3_

- [x] 1.4 E2E 用の seed データを追加する
  - 途中ノードと葉への紐づけ、無効・削除の問題、未解消・解消済みのフラグ、解答履歴による正答率の差がある科目を追加する
  - 1,200 問・選択肢 4,800 件を持つ大量データ用の科目を追加する
  - ローカル DB の再作成後、seed の件数を SQL で確認でき、本番には適用されない
  - _Boundary: supabase/seed.sql（question-exchange の節を追記のみ）_
  - _Requirements: 2.9, 8.3_

- [x] 2. コア: 出力と取込の純粋ロジック

- [x] 2.1 (P) 出力条件の検証と変換を作る
  - 条件の既定値（フラグ条件なし、無効の問題を含めない）を作り、正答率の下限・上限の逆転、範囲外、負の出題数、種類未指定の種類条件をエラーとして返す
  - 画面の百分率を内部の 0〜1 に変換し、出力 RPC に渡す条件に変換する
  - ユニットテストで、逆転・範囲外・種類未指定がエラーになり、変換結果が期待どおりになる
  - _Boundary: conditions.ts_
  - _Requirements: 1.5, 1.6, 1.7, 1.10_

- [x] 2.2 (P) 出力ファイルの組み立てとファイル名を作る
  - 取得した行から、バージョン・出力日時・科目・条件・キーワード階層の全体（階層パス、部分木の集計値）・問題（選択肢、未解消のフラグ、集計値、状態と無効の理由）を持つ出力ファイルを組み立てる。キーワードは木の深さ優先の順に並べる
  - 選択肢・フラグの孤立行を除き、有効な選択肢が2個未満または正解が1つでない問題があれば「出力中にデータが変更されました」として全体を失敗させる
  - 科目名の使えない文字を置き換え、科目名と出力日時を含むファイル名を作る。問題0件でも階層だけのファイルを作れる
  - ユニットテストで、2,500 問の入力が欠落・重複なく組み立てられ、不整合な入力で失敗し、ファイル名が期待どおりになる
  - _Boundary: exportBuild.ts_
  - _Depends: 1.3_
  - _Requirements: 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.9, 2.10, 2.11_

- [x] 2.3 (P) 取込ファイルの参照・構造・作問ルールの検証を作る
  - 現在のデータのスナップショットに対し、科目・キーワード・問題・選択肢の不存在、削除済み、他科目、他の問題の選択肢を位置付きのエラーにする
  - 追加・改名・移動を適用した仮想の木で、循環（新規キーワードを介するものを含む）と同じ親の下の名前の重複を検出する。一時キーの重複・未定義、同じ要素への複数の操作を検出する
  - 修正・新規の各問題を上流の作問ルール検証関数（一時キーは仮の ID として科目のキーワード集合に加える）にかけ、エラーと警告を区別したまま位置付きの問題に変換する。無効の問題の修正は警告にする
  - ユニットテストで、各規則の発生と非発生、重大度、位置の表記が確認できる
  - _Boundary: importValidate.ts_
  - _Depends: 1.3_
  - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.12, 4.13_

- [x] 2.4 差分の計算と修正の判定を作る
  - 問題文・解説・種別・紐づけの集合・選択肢の列（ID、本文、解説、正解、順序）のいずれかが前後空白を除いて変わった場合だけを修正とする判定を作る
  - キーワードの追加・改名・移動（変更前後の階層パス）、修正（変わった項目と選択肢の追加・削除・変更・並べ替え）、新規（階層パス付き）、無効化（すでに無効なら対象外）、変更なしの問題、件数、修正ごとの解消予定のフラグを計算する
  - もとにした出力日時より後に更新された対象に「出力後に更新されています」の警告を付ける
  - ユニットテストで、解説だけの変更が修正になり、空白だけの違いは変更なしになり、同じ名前への改名や同じ親への移動が件数に入らない
  - 2.3 のスナップショット型と検証結果に依存するため、2.3 と並列にしない
  - _Requirements: 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 8.2, 8.3_

- [x] 2.5 適用ペイロードの生成を作る
  - 差分で変化のある操作だけを含め、キーワード追加を親が先になる順に並べ、一時キーを仮の ID 表記に変換した問題の入力を作る
  - 修正・無効化する問題、改名・移動するキーワード、追加・移動の既存の親、紐づけ先の既存キーワードの更新日時を、期待する状態として含める
  - 解消の対象には修正された問題の ID だけを含める
  - ユニットテストで、新規・無効化・変更なしの問題が解消の対象に入らず、期待する状態が設計の対象をすべて含む
  - _Depends: 2.4_
  - _Requirements: 7.1, 8.3_

- [x] 2.6 入出力の API 境界を作る
  - 科目一覧、科目のキーワード全件、条件に一致する件数（行を返さない件数取得）を取得する
  - 出力用に、キーワード、キーワードの集計、問題、選択肢、フラグを並列に共通ページングで取り切り、1つでも失敗すれば全体を失敗させる
  - 取込用に、科目、キーワード全件、ファイルが参照する問題（削除済みを含む）・有効な選択肢・紐づけ・未解消のフラグを 100 件ずつ分けて取得し、スナップショットにする
  - 適用 RPC を呼び、`stale_preview` を専用のエラーにし、その他の失敗を操作の文脈付きの日本語のエラーに変換する
  - ユニットテストで、行の変換、専用エラーへの変換、エラー文言の各分岐、分割取得の境界が確認できる
  - _Depends: 1.1, 1.2, 2.2, 2.3_
  - _Requirements: 1.1, 1.8, 2.5, 2.9, 2.10, 4.4, 6.7, 7.3, 7.4_

- [x] 3. コア: 入出力画面

- [x] 3.1 入出力画面の枠と離脱確認を作る
  - 「出力」「取込」のタブを持つ画面を作り、タブを切り替えても取込の状態を保持する
  - 取込ファイルやプレビューを保持している間、画面内の遷移と画面の離脱を確認ダイアログで止める。ダイアログは確定以外に初期フォーカスし、Esc で閉じる
  - 390px 幅で横スクロールが出ず、未保存のプレビューがある状態で別の画面へ移ろうとすると確認が表示される
  - _Requirements: 10.3, 10.4, 10.6_

- [x] 3.2 (P) 出力パネルを作る
  - 科目の選択、範囲のキーワードを1つ選ぶ木（矢印キーで操作、未選択は科目全体）、フラグ条件（種類は共通の表示名）、統計条件、「無効化された問題を含める」を配置する
  - 条件の変更ごとに遅延付きで件数を表示し、条件のエラーは欄の近くに出して出力を無効にし、0件ではキーワード階層だけの出力を案内する
  - 出力でファイルをダウンロードし、失敗時は警告表示と再試行を出す。PC 幅では条件と木・件数を2列で並べる
  - コンポーネントテストで、条件エラーで出力が無効になり、0件の案内が出る
  - _Boundary: ExportPanel, KeywordScopePicker_
  - _Depends: 2.1, 2.6_
  - _Requirements: 1.1, 1.2, 1.8, 1.9, 1.10, 2.1, 2.10, 10.2, 10.4_

- [x] 3.3 (P) 検証結果と差分プレビューの表示を作る
  - エラーと警告を分けて件数と一覧を出し、各行の位置を人が読める表記（「問題の修正 4件目 / 選択肢 2 / 本文」など）で示す
  - 件数の要約、キーワードの変更前後の階層パス、修正の変わった項目だけの前後比較（選択肢の追加・削除・変更・並べ替えの印付き）、新規の全内容と階層パス、無効化と理由、変更なしの問題（折りたたみ）、解消予定のフラグを表示する
  - 正解の選択肢に共通の正解の色と印を付け、PC 幅では前後比較を2列、モバイルでは縦に並べる
  - コンポーネントテストで、変わった項目だけが前後表示され、正解に共通の印が付き、変更なしが区別される
  - _Boundary: IssueList, DiffPreview_
  - _Depends: 2.4_
  - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 10.2, 10.5_

- [x] 3.4 取込パネルで検証から適用までをつなぐ
  - ファイル選択から読み込み、フォーマット検証、スナップショット取得、参照・作問ルールの検証、差分計算までを、適用せずに行う
  - エラーが1件でもあれば適用を出さず、変化が0件なら「適用する変更はありません」とし、警告があれば確認のチェックを付けるまで適用を無効にする
  - 適用中は適用を無効にし、成功で反映件数と解消したフラグの件数を表示してファイルとプレビューを破棄する
  - `stale_preview` では再検証の操作を出し、同じファイルを現在のデータで検証し直す。その他の失敗では日本語の理由を出し、ファイルとプレビューを保持する
  - コンポーネントテストで、エラーで適用が出ない、警告の確認まで無効、適用中の無効化、中止時の再検証ボタンが確認できる
  - _Depends: 2.5, 2.6, 3.1, 3.3_
  - _Requirements: 4.1, 4.11, 5.9, 5.10, 6.6, 6.7, 6.8, 7.3, 7.4_

- [x] 4. コア: 問題生成 skill とフォーマット文書

- [x] 4.1 (P) フォーマット文書と取込用 JSON の例を作る
  - skill の参照文書として、出力用・取込用の全項目（名前、型、必須・任意、意味）、キーワード参照、選択肢の全体記述と ID の扱い、一時キーの規則、表現できない操作を英語で書く
  - すべての操作を1回以上含む取込用 JSON の例を、内容を日本語で作る
  - 文書にフォーマット識別子・バージョン・全項目名が現れること、例のファイルが取込の検証を通ることをユニットテストで照合し、テストが通る
  - _Boundary: exchange-format.md, example-import.json, formatDoc.test.ts_
  - _Depends: 1.3_
  - _Requirements: 3.9, 9.6_

- [x] 4.2 問題生成 skill を作る
  - 読み書きとファイル検索だけを許可したツール構成で、本文を英語で書く。データベース・ネットワーク・シェルの操作を持たず、取込は所有者に任せる
  - 手順として、フォーマット文書と `product.md` の「問題作成の原則」「問題フラグ」を読み、出力 JSON の種類・バージョンが対応外なら書かずに理由を報告することを定める
  - フラグの種類ごとの対処方針、集計値は優先度の参考にだけ使い取込用 JSON に書かないこと、生成内容を日本語で書くこと、意味が変わる選択肢は ID なしで書くことを定める
  - 書き出し前の自己点検（正解1つ、選択肢の数、重複なし、略語のフルネームが解説にある、問題と各選択肢に解説、1問1情報）と、出力 JSON の隣への書き出し、もとにした出力日時の記録、件数と原則から外れた判断の報告を定める
  - skill を例の出力 JSON に対して実行すると、取込の検証を通る取込用 JSON が出力 JSON の隣に書き出される
  - _Depends: 4.1_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 5. 統合: 導線と生成物の扱い

- [x] 5.1 ルートと生成物の置き場を登録する
  - ルート登録表に管理区分の「入出力」の行（保護ルート）を追加し、入出力画面を表示する
  - 出力・生成した JSON の置き場をバージョン管理の対象外に追加する
  - ログイン後のナビゲーションの管理区分に「入出力」が現れ、未ログインではログイン画面に移る
  - _Boundary: src/app/routes.tsx（行の追加のみ）_
  - _Depends: 3.2, 3.4_
  - _Requirements: 10.1_

- [x] 6. 検証: E2E

- [x] 6.1 出力の E2E を作る
  - 途中のキーワードの範囲・フラグ・正答率の条件で出力し、ダウンロードしたファイルに配下の問題・未解消のフラグだけが含まれ、既定で無効の問題がなく、「含める」で状態付きで含まれることを確認する
  - 1,200 問・選択肢 4,800 件の seed で出力し、件数と ID が欠落・重複なく一致することを確認する
  - 直列実行の E2E が成功する
  - _Depends: 1.4, 5.1_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 6.2 取込・競合・フラグ解消の E2E を作る
  - 全操作を含むファイルを取り込み、プレビューの件数・差分を確認して適用し、ID 不変、外された選択肢の履歴、新規 ID の割り当てを DB で確認する
  - 修正した問題のフラグだけが解消済みになり、変更なし・無効化・新規の問題のフラグが未解消のまま残ることを確認する
  - プレビュー後に別タブで問題を手動編集してから適用すると何も変わらず、再検証で新しい差分が出ることを確認する
  - 上流制約に違反するペイロードを直接 RPC に送ると、キーワード追加もフラグ解消もロールバックされることを確認する
  - 直列実行の E2E が成功する
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 6.3 RLS・レスポンシブ・キーボード操作の E2E を作る
  - 別の所有者のセッションで、所有者の科目が出力に現れず、所有者の問題 ID を含む取込が失敗して何も変わらないことを確認する
  - モバイル（390×844）で横スクロールなし、PC（1280×800）で2列表示、キーボードだけで取込から適用まで操作でき、離脱確認が出ることを確認する
  - 例の取込用 JSON の取込が成功することを確認する
  - 直列実行の E2E が成功する
  - _Requirements: 9.1, 9.6, 10.2, 10.3, 10.4, 10.6, 10.7_

- [x] 7. 変更: 出力条件から「出題の有無」を外す（2026-11-05 の要件 1.6 の変更）

- [x] 7.1 (P) 出力対象の絞り込みから未出題の条件を外す migration を作る
  - 先に、`p_filter` に `attempted: true` を渡しても未出題の問題が対象から外れないことを確かめる SQL の検査を書き、現在の関数で失敗することを確認する
  - 新しい migration `20261108000000_exchange_drop_attempted.sql` で `exchange_private.export_target_ids` を同じシグネチャで置き換え、`attempted` の条件とコメントを外し、`revoke`／`grant` を再記述する。適用済みの migration は編集しない
  - ローカル DB の再作成後、`attempted` の有無で対象の問題 ID が変わらず、正答率・出題数の条件は従来どおり効くことが SQL で確認できる
  - _Boundary: supabase/migrations/20261108000000_exchange_drop_attempted.sql_
  - _Requirements: 1.6_

- [x] 7.2 (P) 型・読み込み検証・条件変換から未出題の条件を外す
  - 先に、`conditions.attempted` を含む出力ファイルが未知の項目のエラーになるテストと、`toExportFilter` の出力に `attempted` が含まれないテストを書き、失敗することを確認する
  - `ExportConditionsSnapshot` と `EXPORT_FIELD_NAMES` から `attempted` を削除し、条件スナップショットの検証、既定値、`toExportFilter` からも削除する。`version` は 1 のまま据え置く
  - `conditions.test.ts` と `parse.test.ts` の既存の `attempted` の記述を更新し、ユニットテストと型検査が通る
  - _Boundary: format.ts, parse.ts, conditions.ts_
  - _Requirements: 1.6, 3.7, 4.3_

- [x] 7.3 出力パネルから「出題の有無」の選択を外す
  - 先に、出力パネルに「出題の有無」の選択がないことを確かめるコンポーネントテストを書き、失敗することを確認する
  - ExportPanel から「出題の有無」の select を削除し、未出題だけを絞るための案内文も置かない
  - コンポーネントテストで「出題の有無」がなく、正答率・出題数の条件と条件エラーで出力ボタンが無効になる挙動が従来どおり通る
  - _Boundary: ExportPanel.tsx_
  - _Depends: 7.2_
  - _Requirements: 1.6, 1.10_

- [x] 7.4 問題生成 skill のフォーマット文書から未出題の条件を外す
  - 先に、フォーマット文書の条件の表に `attempted` が現れないことを確かめる検査を formatDoc.test.ts に加え、失敗することを確認する
  - `exchange-format.md` の条件の表から `attempted` の行を削除し、例の JSON に `attempted` があれば削除する。文書は英語のまま
  - formatDoc.test.ts（全項目名との照合、例の JSON の取込検証）と skillDoc.test.ts が通る
  - _Boundary: .claude/skills/question-authoring/references/exchange-format.md, example-import.json, formatDoc.test.ts_
  - _Depends: 7.2_
  - _Requirements: 1.6, 3.9, 9.6_

- [x] 7.5 出力の E2E を未出題の条件なしに更新する
  - 出力画面に「出題の有無」の選択がなく、ダウンロードしたファイルの `conditions` に `attempted` が含まれないことを確認する検査を加える
  - 出題数の条件での出力が従来どおり配下の対象だけになることを確認する
  - 直列実行の E2E が成功する
  - _Boundary: e2e/exchange.spec.ts_
  - _Depends: 7.1, 7.3_
  - _Requirements: 1.6_

- [x] 8. 拡張: 出典資料からの作成と推測できる問題の検出（Requirement 11〜14）

- [x] 8.1 スクリプトのテスト基盤と取込用 JSON の読み取りを作る
  - `vite.config.ts` のユニットテストの対象に `scripts/**/*.test.ts` を加える
  - `scripts/authoring/importModel.ts` に、取込用 JSON から作成・修正の問題を取り出す最小の型と `extractQuestions` を作る（`src/` は import しない）
  - 完了: `importModel.test.ts` で、作成・修正の問題だけが取り出され、`tempKey` のない作成は `create#<n>` になり、対応外の `format`・`version` で `ok: false` になることが `npm test` で通る
  - _Boundary: scripts/authoring/importModel.ts, vite.config.ts_
  - _Requirements: 12.1, 13.1_

- [x] 8.2 (P) 推測の機械的な点検を作る
  - `scripts/authoring/guessLint.ts` に、文字種の連続と2文字以上の部分文字列による語の取り出しと、6種類の規則（stem_overlap、length_outlier、form_outlier、absolute_word、containment、full_name）を純粋関数で作る。しきい値と一般語の除外リストは定数にまとめる
  - `scripts/authoring/lint-import.ts` に CLI を作る（`<import>.lint.json` と件数の要約、警告ありでも終了コード 0、読めない・対応外は 1）
  - 完了: `guessLint.test.ts` で規則ごとに警告が出る例と出ない例が通り、`node scripts/authoring/lint-import.ts .claude/skills/question-authoring/references/example-import.json` が要約を出して終了コード 0 で終わる
  - _Depends: 8.1_
  - _Boundary: scripts/authoring/guessLint.ts, scripts/authoring/lint-import.ts_
  - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 8.3 (P) 問題ごとの判定の入力・解釈・並列実行を作る
  - `scripts/authoring/blindJudge.ts` に、システムプロンプト、問題文と並べ替えた選択肢だけのプロンプト、`parseJudgeAnswer`、元の位置に戻して正解と照合する `interpret` を作る
  - `scripts/authoring/judgeRunner.ts` に、差し替え可能な `Invoke`、並列数を守る `runJudges`（読めない応答は1回だけ再実行、なお読めなければ `unparsed`、失敗は `error`）を作る
  - 完了: `blindJudge.test.ts` と `judgeRunner.test.ts` が通る（プロンプトに正解・解説が含まれない、手がかりが誤答を指すと `guessable: false`、並列数を超えない、`unparsed` に生の応答と順序と正解の位置が残る）
  - _Depends: 8.1_
  - _Boundary: scripts/authoring/blindJudge.ts, scripts/authoring/judgeRunner.ts_
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.9, 13.11_

- [x] 8.4 判定の CLI と claude -p の呼び出しを作る
  - `judgeRunner.ts` の `claudeInvoke` に、design どおりのオプションと環境変数（`MAX_THINKING_TOKENS=0`、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`）、標準入力でのプロンプト、OS の一時ディレクトリでの実行、`result` の取り出しを作る
  - `scripts/authoring/judge-import.ts` に CLI を作る（`--only`、`--out`、`--concurrency`、`--model`、`--only` のときの結果のマージ、要約、`unparsed`・エラーがあれば終了コード 2）
  - 完了: 2問の取込用 JSON で実際に実行し、`judge.json` に2問ぶんの判定が書かれ、要約に判定数・推測できる数・手がかり別の内訳とトークン数の目安が出ることを確認して、結果を Implementation Notes に記録する
  - _Depends: 8.3_
  - _Boundary: scripts/authoring/judgeRunner.ts, scripts/authoring/judge-import.ts_
  - _Requirements: 13.1, 13.9, 13.11_

- [x] 8.5 問題生成 skill に出典モードと点検・判定の手順を加える
  - `.claude/skills/question-authoring/SKILL.md`（英語）に、出典モードの入力と手順 1〜8、用語ではない語の扱い、誤答の差し替え方針（実在の紛らわしい語 → 難しければ実在しない語と解説への明記）、5回の打ち切り、`unparsed` の読み取り、報告項目を加える。既存の修正モードにも点検と判定の手順を加える
  - `allowed-tools` に2つのスクリプトの実行だけを足す
  - 既存の `skillDoc.test.ts` を、追加した契約（出典モード、2つのスクリプト、5回、報告項目）も検査するよう更新する
  - 完了: `npm test` で `skillDoc.test.ts` が通り、`allowed-tools` に2つのスクリプト以外のシェル操作がない
  - _Depends: 8.2, 8.4_
  - _Boundary: .claude/skills/question-authoring/SKILL.md, src/features/exchange/skillDoc.test.ts_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 12.1, 12.9, 13.6, 13.7, 13.8, 13.10, 14.2_

- [x] 8.6 作業用の場所と steering を整える
  - `.gitignore` に `exchange-data/` があることを確認し、`git ls-files exchange-data` が空であることを確認する
  - `.kiro/steering/structure.md` に `scripts/authoring/` と `exchange-data/` の役割を追記する
  - 完了: `git check-ignore exchange-data/x.json` が一致し、structure.md に2つの場所が記載されている
  - _Boundary: .kiro/steering/structure.md_
  - _Requirements: 14.1_

- [x] 8.7 最初の中分類で受け入れ確認をする
  - シラバスのテキストを `exchange-data/応用情報技術者試験/syllabus.txt` に置き、所有者が作った科目の空の出力 JSON を使って、skill の出典モードで「中分類 1：基礎理論」の取込用 JSON を作る
  - 完了: 取込用 JSON がアプリの検証でエラー0になり、報告に用語数・問題数・点検の警告と対応・判定の内訳・作り直しの回数の分布・未判定の問題が出る。誤検出の割合と1問あたりのトークン数を Implementation Notes に記録し、しきい値の調整が必要かを判断する
  - _Depends: 8.5, 8.6_
  - _Requirements: 11.1, 12.1, 13.1, 13.10_

- [x] 8.8 判定の指示に knowledge 欄を加え、作問方針を skill に反映する（2026-11-08 の要件 11.7、11.12、13.4、13.6 の変更）
  - `JUDGE_SYSTEM_PROMPT` に `knowledge` を加え、知識で分かる答えを推測の手がかりとして数えない
  - SKILL.md に、用語そのものを正解にしない問い方、字面どおりの用語の扱い、計算方法を問う問題、誤答の差し替えで解消しない場合の問い方の変更を加える
  - 完了: `knowledge` が正解を指しても推測できるとしないテストが通り、`skillDoc.test.ts` を含む `npm test` が通る
  - _Boundary: scripts/authoring/blindJudge.ts, .claude/skills/question-authoring/SKILL.md_
  - _Requirements: 11.7, 11.12, 13.4, 13.6_

- [x] 9. 変更: 解説の省略（2026-11-08 の要件 9.9、15 の変更）

- [x] 9.1 フォーマット文書と skill を解説の省略に合わせる
  - `exchange-format.md` に空の解説の意味と作成の規則を書く。SKILL.md の内容規則と自己点検を合わせる
  - 完了: `skillDoc.test.ts` と `formatDoc.test.ts` が通り、空の解説を含む取込用 JSON が `parseImportFile` で `ok: true` になるテストが通る
  - _Depends: subject-catalog 7.2_
  - _Boundary: .claude/skills/question-authoring/, src/features/exchange/*Doc.test.ts, src/features/exchange/parse.test.ts_
  - _Requirements: 9.9, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [x] 9.2 基礎理論の取込用 JSON を新しい規則で整理する
  - 問題全体の解説と、問題文で足りる正解の解説を空にし、誤答の解説と略語のフルネームは残す
  - 完了: アプリの検証と同じ規則でエラー0・警告0になり、所有者がアプリで取り込める
  - _Depends: 9.1_
  - _Requirements: 15.2, 15.4, 15.5_

## Implementation Notes

- 1.1: export の p_filter のキーは flag / flagTypes / correctRateMin / correctRateMax / attemptMin / attemptMax / attempted / includeDisabled（2.1 の toExportFilter はこの名前で出す）。無効の問題は question_stats に行がないため集計値は 0・null（design どおり。4.2 の SKILL.md に一言添える）。
- 共通: 部分木での絞り込みは DB 側で行い、ID 一覧をクライアントへ返さない（API 経由は 1,000 行で切り捨て）。日時は Date.parse で比べる。タスク完了時の報告の STATUS は READY_FOR_REVIEW 等の決まった値にする。
- 1.2: questionUpdates は { input }（input.id 必須）。keywordMoves は配列順に1件ずつ move_keyword するので、2.4 は各段階で循環しない順に並べる。keyword_not_found / question_not_found は 2.5 の toExchangeErrorMessage で汎用メッセージに落ちる。正解1つの検査はコミット時に P0001 one_correct_required。
- 1.3: 検証ライブラリは使わず parse.ts の小さなスキーマ走査で検査する。キーの有無は Object.hasOwn で判定（constructor 等の継承名も未知の項目として報告）。IMPORT_FIELD_NAMES / EXPORT_FIELD_NAMES は 4.1 で追加する。
- 1.4: seed は「E2E 交換テスト」c0000000-0000-4000-8000-000000000001（d001〜d008、解答・フラグ付き）と「E2E 交換大量データ」…0002（1,200 問）。6.x の取込 E2E は seed を書き換えないよう、実行ごとに接頭辞付きの自前データを作ること（出力・集計の E2E は seed を読むだけなら可）。
- 2.1: keywordId は p_filter に含めない。2.6 の API は c.keywordId を RPC の p_keyword_id に別で渡すこと。toSnapshot は flag≠types でも flagTypes を残す（軽微）。
- 2.2: ExportRows と行型（camelCase）は exportBuild.ts に置く。2.6 の api.ts は snake_case の RPC 行をこの型に変換する。ファイル名の日時はローカル時刻、exportedAt は UTC の ISO。
- 2.3: validateImport は移動後の最終状態だけで循環を判定する。2.4/2.5 は keywordMoves を移動後の深さが浅い順に並べ、途中で循環が生じないようにし、親の入れ替え（A/B）のテストを付けること。一時キーの仮 ID は tempKeywordId（`tmp:<tempKey>`）を使う。
- 2.4: ImportSnapshot.keywords は updatedAt を持つ型に広げる（design.md 修正済み）。2.5 で importValidate.ts の型を (Keyword & { updatedAt: string })[] にし diff.ts のキャストを外す、buildApplyPayload は expected.keywords に updatedAt を必須で入れる。2.6 の loadImportSnapshot は keywords の updated_at を取得する。
- 2.5: ApplyPayload はローカル DB の apply_exchange_import で互換を確認済み。expected の比較は timestamptz の一致なので、2.6 は updated_at の文字列を加工せずそのまま渡す（マイクロ秒を落とさない。Date に変換しない）。
- 2.6: api.ts は UUID でない ID を問い合わせから除き、検証側で not_found として報告される。UI 層は supabase を直接呼ばず api.ts だけを使う。
- 3.1: ExchangePage は exportPanel / renderImportPanel({ onHoldingChange }) の差し込み口を持つ。ルートは props なしで描画するため、3.2 と 3.4 で ExchangePage の中に実際のパネルを組み込むこと（3.4 の ImportPanel はファイルかプレビューを持つ間 onHoldingChange(true)）。ExchangeConfirmDialog は exchange 独自の `<dialog>`（他 feature から import しない）。
- 3.3: 修正される問題の紐づくキーワードの変更後パスは、祖先が改名・移動されると古い表記になる（5.2）。diff.ts が afterNodes から修正分の変更後パスを返し、DiffPreview はそれを使うよう 3.4 で直す。エラーは text-text＋アイコン＋「エラー」、警告は text-warn＋アイコン＋「警告」で区別する。
- 3.4: 適用前の確認は警告のチェックボックスだけ（ExchangeConfirmDialog は離脱用）。diff.ts の QuestionChange に afterKeywordPaths を追加し、DiffPreview はそれを使う。
- 4.1: フォーマット文書は英語（.claude/skills は英語の方針、design どおり）で、問題の内容は日本語。IMPORT_FIELD_NAMES / EXPORT_FIELD_NAMES は format.ts に置き、型レベルで全項目と一致させる。example-import.json は架空の ID を使う例示用。
- 4.2: question-authoring skill はドライラン（seed 科目の出力 → 修正2問・新規2問の取込 JSON）で parseImportFile ok、validateImport エラー0・警告0を確認済み。skillDoc.test.ts で SKILL.md の契約を検査する。
- 6.1: e2e/exchange.spec.ts は共通の補助（loadEnv / ownerClient / desktopOnly）を先頭に置き、describe ごとに desktopOnly() を付ける。出力の E2E は seed を読むだけ。
- 6.2: 取込 E2E は実行ごとに exchange-imp- 接頭辞の科目を作って afterAll で消す（seed は触らない）。23505 は制約名で文言を分ける（keywords_sibling_name_key はキーワード名、choices_question_one_correct_key は正解1つ、それ以外は汎用）。
- 6.3: 例の取込用 JSON の E2E は、実行ごとに作る科目の ID へ例の ID を置き換えて取り込む。basedOnExportedAt が古いため警告は必ず出る前提で検査する。
- 手動の動作確認は E2E 用の seed 科目（「E2E 〜」「統計検証」）で行わない。解答やフラグが残ると seed の期待値に頼る E2E が失敗する。手動確認には supabase/demo-data.sql のデモ科目を使い、崩れたら db reset の後にデモデータを入れ直す。
- 8.4: claude は C:\Users\takas\.local\bin\claude.exe（shell なしの spawn で空文字の引数も渡る。.cmd の shim は未対応）。2問の実実行（Haiku 5.5）で約 1,170 トークン/問・約 2.5 秒/問。著作権の例は semantic で推測できる、CPI の例は推測できないと正しく判定。judge-import は未知の --only の ref と壊れた既存結果ファイルで終了コード 1。
- 8.7（途中）: 基礎理論で 354 問を作成（キーワード 385）。lint の警告は 89 問で、form_outlier 86 は誤答側だけなので残した。判定では 274 問（77%）が推測できるとされた（semantic 267、surface のみ 7）。大半は用語の字面がそのまま意味を表すもの（和集合、温度センサーなど）か、Haiku の知識による判定。判定は約 1,130 トークン/問で、354 問で約 40 万トークン。判定の指示と、字面どおりの用語の作問方針を見直してから書き直しに進む。
- 8.7（作り直し）: knowledge 欄つきの判定で全 373 問（計算方法の問題 19 問を追加）を判定し直すと、推測できるのは 136 問（36%、前回は 77%）。書き直しで 0 問になった（1 回 109、2 回 21、3 回 5、5 回 1）。名前を当てる keyword 問題 131 問を feature 問題に変えた。判定は約 1,335 トークン／回、合計約 73 万トークン。理由欄に「知識で分かる」と書きながら surface・semantic にも数える誤判定が少数残る。アプリでの取込検証は所有者が行う。

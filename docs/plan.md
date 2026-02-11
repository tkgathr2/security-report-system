# 警備報告書デジタル承認システム - 仕様書 V3.3（Devin運用章を追加）

進捗率：30%（Planフェーズ：Devin運用章の仕様追加中）

---

## 0. 位置づけ
- 本書は最終仕様書 `docs/plan.md` である
- 実装（Impl）は本書確定後に開始する

---

## 1. 追加で確定すること（V3.1→V3.2の上げ幅）
- 例外ケースの最終挙動（エラー文言、HTTPステータス、Slack文面）
- 監査ログ方針（誰が何をしたか）
- ENV一覧（シークレットはプレースホルダ）
- 受け入れ条件（E2Eで網羅）

---

## 2. エラー仕様（HTTP/画面）
### 2-1. 共通レスポンス
- 成功：200/201 + json
- 失敗：{ "error": "ERROR_CODE", "message": "日本語メッセージ", "details": {...} }

### 2-2. 主要エラーコード
- INVALID_PAYLOAD：400
- UNAUTHORIZED：401（キャストJWTなし/無効）
- ADMIN_UNAUTHORIZED：401（管理者セッションなし）
- FORBIDDEN：403（許可リスト外/案件保留）
- NOT_FOUND：404（案件なし）
- EXPIRED_URL：410（期限切れ）
- CSV_HEADER_MISMATCH：400
- CSV_ENCODING_UNKNOWN：422（プレビュー選択へ誘導）
- MAIL_SEND_FAILED：500（ただし処理は継続しSlack通知）
- SLACK_SEND_FAILED：500（ログのみ、処理は継続）
- PDF_GENERATION_FAILED：500（管理画面に要再生成表示）

---

## 3. 例外ケース最終挙動
### 3-1. 案件URL期限切れ
- GET /api/projects/{url} は 410 + EXPIRED_URL
- 画面は「このURLは無効です（期限切れ）」を表示

### 3-2. 未登録会社（pending_client）
- GET /api/projects/{url} は 403 + FORBIDDEN（message：未登録会社のため保留）
- 管理者が clients 登録→再照合で active へ

### 3-3. メール送信失敗
- 報告書保存・PDF生成は成功扱い
- Slackに「メール送信失敗」通知
- APIは 200で返し、レスポンスに warnings を含める

### 3-4. PDF生成失敗
- reportsは保存（signature_pngは保存）
- pdf_bytes は NULLにせず「生成失敗」状態を reports.status ではなく reportsに pdf_generation_status を追加して管理
  - pdf_generation_status：success/failed
- 管理画面に「PDF再生成」ボタンを表示

※ V3.2でDBに以下カラムを追加確定
- reports.pdf_generation_status text NOT NULL default 'success'
- reports.pdf_generated_at timestamp NULL

---

## 4. 監査ログ方針（最終）
### 4-1. admin_audit_logs
- id uuid PK
- admin_email text NOT NULL
- action text NOT NULL
- target_type text NOT NULL
- target_id text NULL
- payload_json jsonb NOT NULL
- created_at timestamp NOT NULL

### 4-2. 監査対象
- CSV取込（開始/成功/失敗/partial）
- 会社マスタの作成/更新/無効化
- 管理者許可リストの追加/無効化
- PDF再生成
- 未登録会社の再照合

---

## 5. 環境変数一覧（シークレットはプレースホルダ）
- DATABASE_URL=REPLACE_WITH_SECRET
- AUTH_SECRET=REPLACE_WITH_SECRET
- BASE_URL=https://REPLACE_WITH_HOST
- SLACK_WEBHOOK_URL=REPLACE_WITH_SECRET
- SMTP_HOST=REPLACE_WITH_SECRET
- SMTP_PORT=REPLACE_WITH_SECRET
- SMTP_USER=REPLACE_WITH_SECRET
- SMTP_PASS=REPLACE_WITH_SECRET
- GOOGLE_OAUTH_CLIENT_ID=REPLACE_WITH_SECRET
- GOOGLE_OAUTH_CLIENT_SECRET=REPLACE_WITH_SECRET
- GOOGLE_OAUTH_REDIRECT_URL=https://REPLACE_WITH_HOST/api/admin/auth/google/callback

---

## 6. 受け入れ条件（最終：E2E）
### 正常系
- AC-01 CSVアップロード→文字コード自動判定→取込成功
- AC-02 同一案件判定が機能し、複数キャストが1案件に紐づく
- AC-03 未登録会社が検知され、pending_client になりSlack通知される
- AC-04 clients登録→再照合でpending_clientがactiveになる
- AC-05 キャスト自己登録→PINログイン→案件URLでフォーム表示
- AC-06 必須バリデーションが動作（未入力は承認不可）
- AC-07 サイン取得→承認→reports作成（signature_png/pdf_bytesがBLOBで保存）
- AC-08 承認後に先方メール（複数宛先）とSlack通知が送信される
- AC-09 管理者がGoogleログインし、許可リスト外は403になる
- AC-10 管理者設定ページで許可メールを追加し、追加後にログイン可能になる
- AC-11 管理画面でPDF再生成ができる

### 異常系
- AC-20 CSVヘッダー不一致で取込中止（CSV_HEADER_MISMATCH）
- AC-21 URL期限切れで410（EXPIRED_URL）
- AC-22 pending_client案件をキャストが開くと403（FORBIDDEN）
- AC-23 メール失敗時にSlackへ失敗通知が出る（処理継続）
- AC-24 PDF生成失敗時に再生成導線が出る

### オフライン
- AC-30 オフラインで入力/署名まで完了し端末に保存できる
- AC-31 オンライン復帰時に下書き同期が実行される
- AC-32 競合時はclient_updated_at新しい方が採用される

---

## 7. NG例（最終）
- 管理者許可リストなしで管理機能を公開する
- PDF/署名をファイルパス保存にして環境差分で失敗させる
- CSVの未登録会社を無視して通知失敗を常態化させる
- シークレットをmd/ログに残す

---

## 8. 完了条件（V3.2）
- 例外/監査/ENV/ACが揃い、実装者が迷わない
- `docs/plan.md` に同内容を確定し、以後は plan.md が唯一の仕様書として運用できる

---

## 9. Devin運用（実装移管）

### 9-1. 目的
- Devinを「実装（開発）中心」で運用し、開発サイクルを高速化する
- ただし、同種エラーが連続発生した場合は速やかにCursor（司令塔）へエスカレーションし、デバッグを引き継ぐ

### 9-2. 前提条件
- 司令塔は Cursor（本スレッド）
- Devinは実装担当（PR作成まで）
- デバッグ（原因特定）はCursorが担当（エスカレーション後）
- シークレットは人間が管理し、Devinは入力しない

### 9-3. 通常時フロー
1. Cursorが実装タスクをDevinに指示
2. Devinが実装を行い、PRを作成
3. Cursor/人間がPRをレビューし、マージ判断を行う
4. Railwayへ自動デプロイ

### 9-4. 例外時フロー（エスカレーション）
1. Devinが同種エラーを連続3回検知
2. Devinが作業を停止
3. Devinが引き継ぎmdを作成し、Cursorへ報告
4. Cursorがデバッグを引き継ぎ、解決後にDevinへ戻す（または完了）

### 9-5. エスカレーション判定（同種エラーの定義）
以下のすべてが一致した場合に「同種エラー」とみなす：
- エラーメッセージ：先頭500文字が一致（改行含む）
- スタックトレース：先頭10行が一致（改行で分割した行）
- 発生箇所：ファイル名 + 行番号が一致

エスカレーション閾値：
- 連続3回 同種エラーが発生した場合にエスカレーション

連続の定義：
- 同一タスクの同一手順での「試行」を1回と数える
- 試行の途中で成功（期待結果が満たされる）した場合、その時点でカウントはリセットされる

カウントリセット条件：
- エラーが解消した場合
- 異なるエラーが発生した場合
- Cursorから明示的にリセット指示があった場合

#### 9-5-1. データ定義（エラー同一判定の要素）
- error_fingerprint は次の3要素で構成される
  - message_prefix_500：エラーメッセージ先頭500文字
  - stack_prefix_10：スタックトレース先頭10行
  - location：ファイル名 + 行番号

### 9-6. 権限（Devin）
#### GitHub
- ブランチ作成：可
- コミット・プッシュ：可（feature/fix ブランチのみ）
- PR作成：可
- mainへの直接push：不可
- PRマージ：不可（Cursor/人間が実施）

#### Railway
- ログ閲覧：可
- 再デプロイ：可
- 環境変数変更：不可
- DB操作：不可

補足：
- DevinにはGitHub/Railwayへのアクセス権を付与するが、本章の禁止事項が優先される

### 9-7. 引き継ぎmd（エスカレーション時）
#### 必須項目
- タイトル：エラー概要（1行）
- 再現手順（番号付き）
- 直近の試行ログ（連続3回分、省略なし）
- 変更差分（コミットハッシュまたはPR URL）
- 期待結果 / 実結果
- 迷子判定（どこで詰まったか、何を試したか）

#### ファイル命名規則
`docs/devin/escalation/YYYY-MM-DD_HHmm_<概要>.md`

### 9-8. 記録（監査性）
- すべてのエスカレーションは `docs/devin/escalation/` に記録する
- PRには関連するエスカレーションmdへのリンクを含める

### 9-9. 受け入れ条件（Devin運用）
- Devinが実装タスクを受けてPRを作成できる
- 同種エラー連続3回でDevinが作業停止できる
- エスカレーション時に引き継ぎmdが作成され、必須項目が揃っている
- mainへの直接pushが行われない
- Railway環境変数変更・DB操作が行われない
- シークレットがDevinのログ・出力に含まれない

### 9-10. NG例（Devin運用）
- 同じエラーを4回以上試行し続ける
- 「エラーが出ました」だけの報告で引き継ぎmdを作らない
- mainへ直接pushする
- Railway環境変数を変更する / DBを直接操作する
- シークレットをコード・ログ・Issue・チャットに含める

### 9-11. 例外ケース（Devin運用）
#### 9-11-1. 緊急hotfix
- 本番障害など緊急時は、人間の判断で例外的な対応を許可する場合がある
- その場合も事後にPR/Issue等で記録を残す

#### 9-11-2. エラー判定が困難な場合
- エラーメッセージが動的（タイムスタンプ等）で判定困難な場合
- Devinは「判定困難」としてエスカレーションし、Cursorが判断する

#### 9-11-3. 外部サービス起因のエラー
- 外部API障害など、コード修正で解決できないエラー
- Devinは状況を報告し、人間/Cursorの判断を仰ぐ

### 9-12. 完了条件（Devin運用）
- `docs/plan.md`（本章）が確定し、以後は本章が唯一の仕様として運用できる
- Devinが通常時フローでPR作成まで実行できる
- 例外時フロー（連続3回→停止→引き継ぎmd）が運用上成立している

### 9-13. 補助文書（仕様ではない）
- `docs/devin/DEVIN_INSTRUCTIONS.md`（Devinに渡す運用手順）
- `docs/devin/ASK_Devin_Migration.md`（要件定義の元資料）

---

## 10. スタッフ名マスタ（CSV取込・自動追加）

### 10-1. 目的
- スタッフ名を事前にCSVで登録し、報告書入力時に名前候補から選べるようにする
- 日次の案件CSVに新しい名前が含まれていたら、スタッフマスタへ自動追加する

### 10-2. データ定義
#### staff_master テーブル（既存拡張）
- id uuid PK
- name_kanji text NOT NULL（漢字氏名）
- name_kana text NOT NULL UNIQUE（カナ氏名：同一人物判定キー）
- created_at timestamp NOT NULL
- updated_at timestamp NOT NULL
- created_by text NULL（監査用：追加した管理者メール）

#### CSV列定義
- 氏名（漢字）：必須
- フリガナ（カナ）：必須

### 10-3. API仕様
#### POST /api/admin/staff/import
- 認証：管理者セッション必須
- リクエスト：multipart/form-data（CSVファイル）
- 処理：
  1. CSVをパース（UTF-8前提、BOMあり対応）
  2. 各行について：
     - カナ氏名で既存検索
     - 存在しない → INSERT
     - 存在する → 漢字が異なれば UPDATE
  3. 監査ログ記録（action: staff_import）
- レスポンス：{ inserted: number, updated: number, skipped: number }

### 10-4. 日次データ連携
- 案件CSVインポート（POST /api/admin/csv/import）時に、スタッフ名（キャスト名）を自動でスタッフマスタへ追加
- 同一人物判定はカナ氏名で行う
- 新規のみ追加（既存は更新しない：案件CSV由来の場合）

### 10-5. 監査ログ
- action: staff_import（一括インポート）
- action: staff_auto_add（日次データからの自動追加）
- payload_json: { file_name, inserted, updated, skipped }

### 10-6. 受け入れ条件
- AC-40: スタッフCSV（氏名・フリガナ）をインポートできる
- AC-41: カナ一致で既存スタッフの漢字が更新される
- AC-42: 新規スタッフが即時追加される
- AC-43: インポート操作が監査ログに記録される
- AC-44: 案件CSVインポート時に新しい名前が自動追加される

### 10-7. NG例
- カナ氏名が空欄のまま登録する
- 同一カナで複数レコードを作成する
- 監査ログなしでインポートを実行する

---

## 11. 管理画面：案件一覧（MVP：無限スクロール廃止・今日/前日/翌日・日付指定）

### 11-1. 目的
- 管理画面の「案件一覧」を、無限スクロール（くるくる回る連続ロード）なしで、必要最小限の操作で参照できるようにする
- MVPは「今日が見える」ことを最優先とし、次に「前日/翌日」「日付指定」を満たす

### 11-2. 前提条件
- 対象画面：管理画面の案件一覧（`/api/admin/projects` を使う一覧）に限定する
- 「今日」は日本の日付（JST）での本日を指す
- 本仕様で「日付」と言う場合、原則として `projects.work_date`（現場日）を指す

### 11-3. 画面仕様（MVP）
#### 11-3-1. 初期表示
- 画面を開いた初期表示は **今日（JST）** に固定する
- 初期表示時に当日の案件一覧を取得する

#### 11-3-2. 表示対象
- 表示対象は **選択中の日付（JST）の当日分のみ** とする（複数日をまとめて一覧表示しない）
- 当日に案件が無い場合は、当日の日付を表示したまま「案件がありません」を表示する（自動ジャンプしない）

#### 11-3-3. 操作（ナビゲーション）
- **前日**：選択日から1日戻す
- **翌日**：選択日から1日進める
- **日付指定**：カレンダーUI（ポップアップ）で日付を選択できる
  - ブラウザのネイティブカレンダー表示（`type="date"` など）でもよい

#### 11-3-4. 検索・フィルタ（MVP）
- MVPでは、既存の「検索（全文/項目別）」および「期間フィルタ」は **画面から外す**（UIとして提供しない）

#### 11-3-5. 読み込み中の挙動
- 日付の移動/指定を行った場合は、その日付の取得が完了するまで「読み込み中」を表示する
- 読み込み中は、連続操作により同じ日付の取得が多重発火しないこと（くるくる回る連続ロードを発生させない）

### 11-4. API仕様（利用）
#### 11-4-1. GET /api/admin/projects（当日分取得）
- 認証：管理者セッション必須
- クエリ（MVPはこれに統一）：
  - `date=YYYY-MM-DD`（当日、JST基準で選択した日付）
- レスポンス：既存仕様どおり（`projects` 配列）

### 11-5. データ定義
- 選択中日付（selectedDate）：`YYYY-MM-DD` 形式の文字列（JST基準）
- 今日（todayJst）：JST基準の当日を `YYYY-MM-DD` にしたもの

### 11-6. 例外ケース
- 管理者セッションが無い場合：従来どおりログイン導線を表示する
- API取得に失敗した場合：従来どおりエラーメッセージを表示する（MVPではリトライ導線は必須としない）

### 11-7. 受け入れ条件（MVP）
- AC-50：案件一覧画面を開くと、今日（JST）の一覧が表示される
- AC-51：前日/翌日で1日ずつ移動でき、移動先の当日分のみが表示される
- AC-52：カレンダーポップアップで任意の日付を選択でき、その当日分のみが表示される
- AC-53：当日に案件が無い場合、「案件がありません」を表示する（自動ジャンプしない）
- AC-54：無限スクロール由来の連続ロード（くるくる）が発生しない

### 11-8. NG例
- スクロール操作だけで日付範囲が自動拡張される（無限スクロールの継続）
- 今日が最初に見えず、ユーザーが探さないと到達できない
- 当日に案件が無いときに、勝手に別日へ移動する

### 11-9. 完了条件（MVP）
- 受け入れ条件（AC-50〜54）を満たす
- 「案件一覧」画面で無限スクロール由来の追加取得が発生しない
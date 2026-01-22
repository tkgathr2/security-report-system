# 警備報告書デジタル承認システム - 仕様書 V3.2（第2回 100点＝最終版）

進捗率：35%（Planフェーズ：仕様書 第1回60→100 完了）

---

## 0. 仕様書憲法（このプロジェクトの運用ルール）
- 仕様書は最終的に `docs/plan.md` を唯一の仕様書とする
- 仕様変更は必ず新規mdを作成して反映する（既存md上書き禁止）
- 推測で補完しない。不明点は仕様に「未決」と書かず、必ず決め切る

---

## 1. 前提条件
- 端末：iPhone（Safari iOS 15以上）
- フロント：PWA（React + TypeScript）
- バック：Node.js + Express
- DB：PostgreSQL
- ホスティング：Railway
- 時刻表記：HH:mm（24時間）
- 日付表記：YYYY-MM-DD
- URL有効期限：実施日＋3日で無効

---

## 2. ユーザー種別・認証・権限
### 2-1. キャスト（現場）
- 認証：メール＋PIN（4〜6桁数字）
- PIN保存：bcryptハッシュ
- ログインJWT：有効期限 7日（更新は再ログインでよい）

### 2-2. 管理者（運用）
- 認証：Google OAuth（管理画面のみ）
- 認可：Googleのメールアドレスが「許可リスト」に存在する場合のみ管理機能を表示
- 初期許可メール：`atsuhiro@takagi.bz` を必ず登録して起動できる状態にする
- 管理者設定ページ：許可メールの追加/削除/無効化ができる

---

## 3. データ定義（DB仕様：第1回確定）
### 3-1. clients（会社マスタ）
- id: uuid PK
- name: text NOT NULL
- name_normalized: text NOT NULL UNIQUE
- emails: text[] NOT NULL（複数可）
- is_active: boolean NOT NULL default true
- created_at/updated_at: timestamp

### 3-2. admin_allowlist（管理者許可リスト）
- id: uuid PK
- email: text NOT NULL UNIQUE
- is_active: boolean NOT NULL default true
- created_at/updated_at: timestamp
- created_by_admin_email: text NOT NULL（監査用）

### 3-3. projects（案件）
- id: uuid PK
- project_key: text NOT NULL UNIQUE
  - project_key生成元：実施日 + 案件名 + 実施場所 + クライアント名（正規化後） を連結しSHA-256
- client_id: uuid NULL REFERENCES clients(id)
- client_name_raw: text NOT NULL（CSVのG列原文を保持）
- work_date: date NOT NULL（F列）
- work_name: text NOT NULL（AL列）
- location: text NOT NULL（I列）
- start_time: text NULL（L列、HH:mm）
- end_time: text NULL（M列、HH:mm）
- break_time: text NULL（N列、HH:mm）
- work_title_raw: text NOT NULL（H列：案件名）
- qualifier_hint: text NULL（H列末尾括弧の中身）
- unique_url: text NOT NULL UNIQUE（UUID）
- url_expires_at: timestamp NOT NULL（work_date + 3日 23:59:59）
- status: text NOT NULL
  - 値：active / pending_client / expired
- created_at/updated_at: timestamp

### 3-4. project_casts（案件に属するキャスト一覧）
- id: uuid PK
- project_id: uuid NOT NULL REFERENCES projects(id)
- staff_no: text NOT NULL（B列）
- cast_name: text NOT NULL（C列）
- row_index: int NOT NULL（CSV出現順）
- UNIQUE(project_id, staff_no)

### 3-5. reports（報告書：承認済み）
- id: uuid PK
- project_id: uuid NOT NULL REFERENCES projects(id)
- cast_user_id: uuid NOT NULL REFERENCES cast_users(id)
- supervisor_name: text NOT NULL
- writer_name: text NOT NULL
- weather: text NOT NULL（sunny/cloudy/rain）
- guard_contents: text[] NOT NULL（8択+other）
- guard_other_text: text NULL
- overtime_hours: int NULL（0〜10）
- has_qualifier: boolean NOT NULL
- qualifier_name: text NULL
- signature_png: bytea NOT NULL（PNG、透過）
- pdf_bytes: bytea NOT NULL（A4縦PDF）
- status: text NOT NULL（approved固定）
- approved_at: timestamp NOT NULL
- created_at: timestamp NOT NULL

### 3-6. report_drafts（下書き：オフライン同期用）
- id: uuid PK
- project_id: uuid NOT NULL REFERENCES projects(id)
- cast_user_id: uuid NOT NULL REFERENCES cast_users(id)
- payload_json: jsonb NOT NULL（フォーム内容、署名含む）
- client_updated_at: timestamp NOT NULL（端末側更新時刻）
- server_updated_at: timestamp NOT NULL（サーバー側更新時刻）
- UNIQUE(project_id, cast_user_id)

### 3-7. csv_imports（CSV取込履歴）
- id: uuid PK
- imported_by_admin_email: text NOT NULL
- original_file_name: text NOT NULL
- detected_encoding: text NOT NULL（utf8_bom/utf8/cp932/unknown）
- status: text NOT NULL（success/failed/partial）
- created_projects_count: int NOT NULL
- skipped_rows_count: int NOT NULL
- pending_client_rows_count: int NOT NULL
- errors_json: jsonb NOT NULL
- created_at: timestamp NOT NULL

---

## 4. CSV取込仕様（第1回確定）
### 4-1. 対象
- `salary - *.csv` を管理画面から毎日アップロード

### 4-2. 文字コード
- 自動判定：UTF-8(BOMあり/なし)、CP932
- 判定失敗時：プレビュー画面でUTF-8/CP932を選ばせる（管理者）

### 4-3. 必須ヘッダー（列名）
- No.
- スタッフNo.
- 氏名
- 実施日
- クライアント名
- 案件名
- 実施場所
- 開始時間
- 終了時間
- 休憩時間
- 業務内容(2)

### 4-4. 行スキップ条件
- 上記必須列のいずれかが欠損 → その行はスキップし、取込履歴に記録（partial扱い）

### 4-5. 同一案件判定（案件まとめ）
- キー：実施日(F) + 案件名(H) + 実施場所(I) + クライアント名(G)
- 同一キーの行は同一案件（projects）にまとめ、project_castsに複数キャストを登録

### 4-6. 会社マスタ照合
- CSVのクライアント名（G列）を正規化して照合
- 未登録の場合：
  - projects.status = pending_client
  - Slackにアラート送信
  - 管理画面の未登録会社一覧に表示
- 登録後：再照合ボタンで pending_client を active にできる

### 4-7. 冪等性（同じCSVを再投入）
- projects.project_key を UNIQUE とし、既存があれば「project_castsの不足分だけ追加」する
- csv_imports に履歴を必ず残す

---

## 5. 報告書フォーム仕様（第1回確定）
### 5-1. 自動反映（表示専用）
- 宛先会社名：G列（クライアント名）
- 勤務場所：I列（実施場所）
- 日付：F列（実施日）
- 作業名称：AL列（業務内容(2)）
- 警備員氏名：当該案件の全キャスト名（project_casts順）

### 5-2. 入力（必須/条件必須）
- 監督者名：必須
- 記入者名：必須（ログインキャスト名）
- 天候：必須（晴/曇/雨）
- 警備内容：必須（複数選択、1件以上）
- その他自由入力：条件必須（other選択時）
- 早出残業：任意（0〜10、0=なし）
- 資格者：必須（有/無）
- 資格者氏名：条件必須（有のとき）
- 監督者サイン：必須（PNG透過、最大500KB）

### 5-3. 資格者の初期値
- 案件名（H列）末尾に括弧があれば「有」を初期選択
- 括弧内文字列を資格者氏名初期値に入れる（編集可）

---

## 6. オフライン仕様（第1回確定）
- 端末側：IndexedDBに「署名済み未承認」まで保存（最大10件、古い順削除）
- サーバー側：report_drafts に保存（同期用）
- 競合解決：client_updated_at が新しい方を採用（同値なら server_updated_at が新しい方）

---

## 7. 通知仕様（第1回確定）
### 7-1. 先方メール通知
- トリガー：承認後
- 宛先：clients.emails（複数） + projectsの個別上書き（将来拡張）
- 添付：PDF（pdf_bytes）
- 失敗時：Slackに失敗通知（再送キューなし）

### 7-2. 社内Slack通知
- トリガー：承認後
- 内容：会社名、実施日、案件名、PDF参照方法（管理画面リンク想定）

---

## 8. API仕様（第1回確定：エンドポイント確定）
### 8-1. キャスト認証
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/pin-reset/request
- POST /api/auth/pin-reset/confirm

### 8-2. 案件取得
- GET /api/projects/{unique_url}
  - projects.status が pending_client の場合：404ではなく 403で「未登録会社のため保留」エラー

### 8-3. 下書き（同期）
- PUT /api/drafts/{project_unique_url}
- GET /api/drafts/{project_unique_url}

### 8-4. 承認（報告書作成）
- POST /api/reports/approve
  - 成功時に reports を作成し、pdf_bytes と signature_png を保存し、通知を実行

### 8-5. 管理者（Google認証 + 許可リスト）
- GET /api/admin/auth/google/start（Googleへリダイレクト）
- GET /api/admin/auth/google/callback（セッション確立）
- GET /api/admin/me（ログイン状態確認）

### 8-6. 管理機能
- POST /api/admin/csv/import（CSVアップロード）
- GET /api/admin/csv/imports（取込履歴）
- GET /api/admin/clients（会社一覧）
- POST /api/admin/clients
- PUT /api/admin/clients/{id}
- GET /api/admin/pending-clients（未登録一覧）
- POST /api/admin/reconcile-clients（再照合）
- GET /api/admin/projects（案件一覧）
- GET /api/admin/reports（報告書一覧）
- GET /api/admin/reports/{id}/pdf（PDFダウンロード）
- POST /api/admin/reports/{id}/regenerate-pdf（再生成）
- GET /api/admin/admin-allowlist（許可リスト一覧）
- POST /api/admin/admin-allowlist
- PUT /api/admin/admin-allowlist/{id}

---

## 9. 受け入れ条件（V3.1）
- CSV取込ができ、案件が生成される（複数キャストも1案件にまとまる）
- 未登録会社は保留になりSlackアラートが出る
- キャスト登録/ログインができる
- サイン取得→承認で報告書がDBに保存され、PDF/署名がBLOBで保存される
- 通知が送られる（失敗時はSlack通知）

---

## 10. NG例（V3.1）
- clients未登録の案件をactive扱いにして通知失敗を発生させる
- PDF/署名をファイルパスで保存し、環境差分で参照不能にする
- 管理者の認可なしで管理画面を開ける

---

## 11. 完了条件（V3.1）
- DB/CSV/API/画面/オフライン/通知が矛盾なく一本化されている
- 「管理者Google認証＋許可リスト＋設定ページ」の仕様が確定している

---

## 追補 V3.2（最終版で追加・強化された仕様）

# 警備報告書デジタル承認システム - 仕様書 V3.2（第2回 100点＝最終版）

進捗率：40%（Planフェーズ：仕様書 第2回60→100 完了）

---

## 0. 位置づけ
- 本書は最終仕様書 `docs/plan.md` と同一内容で確定する（差分なし）
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

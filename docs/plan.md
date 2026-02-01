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

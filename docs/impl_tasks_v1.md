# Impl フェーズ タスク一覧 V1

仕様書の正：docs/plan_v2.md

---

## 0. バックエンド起動方法

```bash
cd backend
npm install
npm run dev
```

起動後のエンドポイント:
- GET http://localhost:3000/health → `{ "ok": true }`
- GET http://localhost:3000/version → `{ "spec": "plan_v2", "app": "security-report-system" }`

マイグレーション実行:
```bash
cd backend
npm run migrate up
```

マイグレーションツール: node-pg-migrate（シンプルでSQL直書き可能、ORMに依存しない）

---

## 1. 実装の前提
- ホスティング：Railway
- DB：PostgreSQL
- バックエンド：Node.js + Express
- フロントエンド：React + TypeScript（PWA）
- 管理者認証：Google OAuth
- メール送信：SMTP
- 社内通知：Slack Webhook

---

## 2. マイグレーション作業
- clients テーブル作成
- admin_allowlist テーブル作成
- projects テーブル作成
- project_casts テーブル作成
- reports テーブル作成（pdf_generation_status, pdf_generated_at 含む）
- report_drafts テーブル作成
- csv_imports テーブル作成
- admin_audit_logs テーブル作成
- 初期管理者メール（atsuhiro@takagi.bz）の投入

---

## 3. API 実装作業
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/pin-reset/request
- POST /api/auth/pin-reset/confirm
- GET /api/projects/{unique_url}
- PUT /api/drafts/{project_unique_url}
- GET /api/drafts/{project_unique_url}
- POST /api/reports/approve
- GET /api/admin/auth/google/start
- GET /api/admin/auth/google/callback
- GET /api/admin/me
- POST /api/admin/csv/import
- GET /api/admin/csv/imports
- GET /api/admin/clients
- POST /api/admin/clients
- PUT /api/admin/clients/{id}
- GET /api/admin/pending-clients
- POST /api/admin/reconcile-clients
- GET /api/admin/projects
- GET /api/admin/reports
- GET /api/admin/reports/{id}/pdf
- POST /api/admin/reports/{id}/regenerate-pdf
- GET /api/admin/admin-allowlist
- POST /api/admin/admin-allowlist
- PUT /api/admin/admin-allowlist/{id}

---

## 4. フロント実装作業
- キャスト登録画面
- キャストログイン画面
- 報告書フォーム画面（案件URL経由）
- 署名パッド
- オフライン対応（IndexedDB）
- 管理者ログイン画面（Google OAuth）
- 管理者ダッシュボード
- CSV取込画面
- 会社マスタ管理画面
- 未登録会社一覧画面
- 案件一覧画面
- 報告書一覧画面
- 管理者許可リスト設定画面

---

## 5. CSV 取込実装作業
- 文字コード自動判定（UTF-8 BOM/UTF-8/CP932）
- 必須ヘッダー検証
- 同一案件判定ロジック（project_key 生成）
- 会社マスタ照合
- 冪等性（既存案件への追加）
- 取込履歴保存

---

## 6. PDF 生成実装作業
- A4縦フォーマット生成
- 署名PNG埋め込み
- pdf_bytes への BLOB 保存
- 生成失敗時の pdf_generation_status 更新
- 再生成機能

---

## 7. 通知実装作業
- 先方メール送信（複数宛先、PDF添付）
- 社内Slack通知
- メール失敗時のSlackアラート
- 未登録会社検知時のSlackアラート

---

## 8. 受け入れ条件チェック
- AC-01〜AC-11（正常系）
- AC-20〜AC-24（異常系）
- AC-30〜AC-32（オフライン）

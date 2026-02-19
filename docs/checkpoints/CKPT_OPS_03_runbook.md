# CKPT_OPS_03: 運用手順 Runbook

## 目的

本番運用に必要な基本手順（再起動/失敗対応/再送/ログ確認/監査）をまとめる。

## 確認日時

2026-01-23 15:24 UTC

---

## 1. サービス再起動

### Railwayダッシュボードから

1. Railway ダッシュボードにログイン
2. プロジェクト「respectful-embrace」を選択
3. サービスの「...」メニュー → 「Restart」をクリック
4. ログで `Server is running on port {PORT}` を確認

### 手動再デプロイ

1. GitHubで空コミットをpush、または
2. Railway ダッシュボードで「Redeploy」をクリック

---

## 2. 障害対応

### サーバーが起動しない場合

**確認手順:**
1. Railway ダッシュボードでビルドログを確認
2. `npm install` または `npm run build` でエラーがないか確認
3. 環境変数（DATABASE_URL, JWT_SECRET, AUTH_SECRET）が設定されているか確認

**よくある原因:**
| 症状 | 原因 | 対処 |
|------|------|------|
| ビルドエラー | TypeScriptコンパイルエラー | ローカルで `npm run build` を実行して修正 |
| 起動後すぐ終了 | DB接続失敗 | DATABASE_URLを確認、PostgreSQLがOnlineか確認 |
| ヘルスチェック失敗 | ポート不一致 | PORT環境変数が正しく設定されているか確認 |

### DB接続エラー

```bash
# PostgreSQLの状態確認（Railwayダッシュボード）
# - Status: Online であること
# - DATABASE_URL が正しく設定されていること

# ローカルからの接続テスト（必要に応じて）
psql $DATABASE_URL -c "SELECT 1;"
```

### マイグレーションエラー

```bash
# 手動でマイグレーション実行（Railway Shell）
cd backend && npm run migrate:up

# マイグレーション状態確認
cd backend && npm run migrate -- status
```

---

## 3. 通知再送

### メール再送が必要な場合

現在の実装では自動再送機能はありません。以下の手順で対応:

1. 報告書IDを特定
2. DBから該当レポートのPDFを取得
3. 手動でメール送信

```sql
-- 報告書情報取得
SELECT r.id, r.approved_at, p.work_name, p.client_name_raw
FROM reports r
JOIN projects p ON r.project_id = p.id
WHERE r.id = '{report_id}';

-- PDF取得（base64エンコード）
SELECT encode(pdf_bytes, 'base64') FROM reports WHERE id = '{report_id}';
```

### Slack通知が失敗した場合

1. SLACK_WEBHOOK_URL が正しく設定されているか確認
2. Webhook URLが有効か確認（Slack App設定）
3. 必要に応じて手動でSlackに投稿

---

## 4. ログ確認

### Railwayログ確認

1. Railway ダッシュボード → プロジェクト選択
2. 「Logs」タブをクリック
3. フィルタで期間を指定

### 重要なログパターン

| パターン | 意味 |
|----------|------|
| `Server is running on port` | 正常起動 |
| `[PDF] Generated PDF: XXX bytes` | PDF生成成功 |
| `[EMAIL] SMTP not configured` | SMTP未設定（警告） |
| `[SLACK] Webhook URL not configured` | Slack未設定（警告） |
| `error:` | エラー発生 |

### エラーログ検索

Railway ダッシュボードのログ検索で `error` をフィルタ

---

## 5. 監査・データ確認

### 報告書一覧確認

```sql
-- 最近の報告書
SELECT r.id, r.approved_at, r.status, p.work_name, p.client_name_raw
FROM reports r
JOIN projects p ON r.project_id = p.id
ORDER BY r.approved_at DESC
LIMIT 20;
```

### CSV取込履歴

```sql
-- CSV取込履歴
SELECT id, filename, status, created_projects_count, skipped_rows_count, created_at
FROM csv_imports
ORDER BY created_at DESC
LIMIT 10;
```

### 案件状態確認

```sql
-- 案件状態別カウント
SELECT status, COUNT(*) FROM projects GROUP BY status;

-- pending_client案件一覧
SELECT id, work_name, client_name_raw, created_at
FROM projects
WHERE status = 'pending_client'
ORDER BY created_at DESC;
```

### 管理者allowlist確認

```sql
-- 許可された管理者メール一覧
SELECT email, created_at FROM admin_allowlist ORDER BY created_at;
```

---

## 6. バックアップ・リストア

### PostgreSQLバックアップ

Railway PostgreSQLは自動バックアップが有効（設定による）

手動バックアップ:
```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

### リストア

```bash
psql $DATABASE_URL < backup_YYYYMMDD.sql
```

---

## 7. 緊急連絡先・エスカレーション

| 状況 | 対応 |
|------|------|
| サービス停止 | Railway Status確認 → 再起動 → 開発者連絡 |
| データ不整合 | DBバックアップ確認 → 開発者連絡 |
| セキュリティインシデント | サービス停止 → 開発者・管理者連絡 |

---

## 8. 定期メンテナンス

### 推奨タスク

| 頻度 | タスク |
|------|--------|
| 毎日 | ログ確認（エラー有無） |
| 毎週 | 報告書件数確認、pending_client案件確認 |
| 毎月 | DBバックアップ確認、ストレージ使用量確認 |

---

## 9. Sentry エラー監視（#重大_システムエラー）

### 動作確認済み

- **確認日**: 2026-02-19
- **実施内容**:
  - Backend: `node -e` で `Sentry.captureException(new Error(...))` を送信 → Sentry → Slack 到着確認
  - Frontend: 本番サイトの DevTools Console で `setTimeout(() => { throw new Error(...) })` を実行 → Sentry → Slack 到着確認
- **期待結果**: `#重大_システムエラー` に Sentry からの通知が届く
- **結果**: Backend（HOUKO-BACKEND-4）、Frontend（HOUKO-FRONTEND-3）の両方で Slack 通知を確認

### 通知対象

| 対象 | 対象外 |
|------|--------|
| level = `error` 以上 | 400 Bad Request（クライアント起因） |
| uncaughtException / unhandledRejection | 404 Not Found |
| フロントエンドの runtime error | 意図的な警告・info レベル |

### 障害検知時の対応フロー

```
1. #重大_システムエラー に通知が届く
   ↓
2. 通知内のリンクをクリック → Sentry Issue 詳細を開く
   ↓
3. 一次切り分け:
   - stack trace でエラー箇所を特定
   - environment / release タグで影響範囲を確認
   - 同じ Issue の発生頻度を確認（1回だけか、連続か）
   ↓
4. 対応判断:
   - 単発: Issue を監視（Sentry 上で Assignee を設定）
   - 連続発生: 即座に修正対応、必要なら Railway で Rollback
   - サービス影響あり: Railway ダッシュボードで Restart → 原因調査
```

### 関連ドキュメント

- Sentry 設定詳細: `docs/checkpoints/CKPT_SENTRY_01_railway_setup.md`
  - Section D: テスト Issue の Resolve 手順
  - Section E: Alert Rule の Environment を production に絞る手順

---

## 付録: 環境変数一覧

| 変数名 | 必須 | 用途 |
|--------|------|------|
| DATABASE_URL | 必須 | PostgreSQL接続 |
| JWT_SECRET | 必須 | キャストJWT署名 |
| AUTH_SECRET | 必須 | セッション暗号化 |
| GOOGLE_OAUTH_CLIENT_ID | 任意 | OAuth |
| GOOGLE_OAUTH_CLIENT_SECRET | 任意 | OAuth |
| GOOGLE_OAUTH_REDIRECT_URL | 任意 | OAuth callback |
| SMTP_HOST | 任意 | メール通知 |
| SMTP_PORT | 任意 | メール通知 |
| SMTP_USER | 任意 | メール通知 |
| SMTP_PASS | 任意 | メール通知 |
| SMTP_FROM | 任意 | メール通知 |
| SLACK_WEBHOOK_URL | 任意 | Slack通知 |
| SENTRY_DSN | 任意 | Sentry エラー送信先（backend） |
| SENTRY_ENVIRONMENT | 任意 | Sentry 環境タグ（backend） |
| VITE_SENTRY_DSN | 任意 | Sentry エラー送信先（frontend、ビルド時） |
| VITE_SENTRY_ENVIRONMENT | 任意 | Sentry 環境タグ（frontend、ビルド時） |

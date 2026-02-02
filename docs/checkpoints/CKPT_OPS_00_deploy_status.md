# CKPT_OPS_00: 本番デプロイ状況確認

## 目的

本番URLの有無を整理し、OPS-1に進めるかを判断する。

## 確認日時

2026-01-23 14:22 UTC

## 現状確認

### ブランチ構成

| ブランチ | 内容 |
|----------|------|
| `main` | 仕様書のみ（実装コードなし） |
| `plan-spec` | 仕様書 |
| `devin/1769132858-s1a-backend-minimal` | 実装コード（backend/frontend） |

### デプロイ設定ファイル

| ファイル | 存在 |
|----------|------|
| `railway.toml` | なし |
| `Procfile` | なし |
| `Dockerfile` | なし |
| `docker-compose.yml` | なし |

### 仕様書記載のホスティング

- docs/plan_v2.md: 「ホスティング：Railway」と記載

---

## 判定

### デプロイ有無: NO

本番デプロイは存在しません。

### 本番URL: 未確定

本番URLは確定していません。

---

## 次のアクション

**OPS-0で停止**（OPS-1には進まない）

### OPS-1に進むために必要な最小作業

1. **Railway初回セットアップ**
   - Railwayアカウント作成/ログイン
   - 新規プロジェクト作成
   - PostgreSQLアドオン追加

2. **デプロイ設定ファイル作成**
   - `railway.toml` または環境変数設定
   - ビルドコマンド: `cd backend && npm install && npm run build`
   - 起動コマンド: `cd backend && npm start`

3. **mainブランチへのマージ**
   - `devin/1769132858-s1a-backend-minimal` → `main` へPR作成・マージ
   - または Railway で直接ブランチ指定

4. **環境変数設定**
   - `DATABASE_URL` (Railway PostgreSQL)
   - `JWT_SECRET`
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URL`
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`
   - `SLACK_WEBHOOK_URL`

5. **初回デプロイ実行**
   - Railway CLIまたはダッシュボードからデプロイ
   - 本番URL取得

6. **DNS設定（任意）**
   - カスタムドメイン設定

---

## 備考

- 実装コードはE2Eテスト完了済み（CKPT_030）
- ローカル環境では全機能が正常動作することを確認済み
- 本番デプロイ後、OPS-1（本番ENV確認）→ OPS-2（本番スモーク）→ OPS-3（Runbook）へ進行可能

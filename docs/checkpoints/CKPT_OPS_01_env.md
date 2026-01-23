# CKPT_OPS_01: 本番ENV設定

## 目的

本番ENVを投入し、/health /version が正常に返ることを確認する。

## 確認日時

2026-01-23 15:22 UTC

---

## Railwayプロジェクト情報

| 項目 | 値 |
|------|-----|
| プロジェクト名 | zippy-strength |
| Root Directory | backend |
| PostgreSQL | 追加済み（Online） |

---

## 環境変数一覧

### 必須（サーバー起動に必要）

| 変数名 | 用途 | 設定方法 |
|--------|------|----------|
| `DATABASE_URL` | PostgreSQL接続文字列 | Railwayアドオンで自動設定 |
| `JWT_SECRET` | キャストJWT署名キー | `openssl rand -base64 32` で生成 |
| `AUTH_SECRET` | セッション暗号化キー | `openssl rand -base64 32` で生成 |

### Google OAuth（管理者ログイン用）

| 変数名 | 用途 | 備考 |
|--------|------|------|
| `GOOGLE_CLIENT_ID` | OAuth クライアントID | Google Cloud Consoleで取得 |
| `GOOGLE_CLIENT_SECRET` | OAuth クライアントシークレット | Google Cloud Consoleで取得 |
| `GOOGLE_REDIRECT_URI` | コールバックURL | `https://{domain}/api/admin/auth/google/callback` |

### 通知（任意）

| 変数名 | 用途 |
|--------|------|
| `SMTP_HOST` | SMTPサーバーホスト |
| `SMTP_PORT` | SMTPポート（通常587） |
| `SMTP_USER` | SMTP認証ユーザー |
| `SMTP_PASS` | SMTP認証パスワード |
| `SMTP_FROM` | 送信元メールアドレス |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

---

## シークレット生成コマンド

```bash
# JWT_SECRET
openssl rand -base64 32

# AUTH_SECRET
openssl rand -base64 32

# または Node.js で
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 確認手順

### 1. デプロイ実行

Railwayダッシュボードでデプロイを実行（またはGitHub連携で自動デプロイ）

### 2. ビルドログ確認

```
cd backend && npm install && npm run build
```
が成功していることを確認

### 3. 起動ログ確認

```
cd backend && npm run migrate:up && npm start
Server is running on port {PORT}
```
が出力されていることを確認

### 4. エンドポイント確認

```bash
# 本番URL（例）
PROD_URL="https://zippy-strength.up.railway.app"

# /health
curl -s $PROD_URL/health
# 期待: {"ok":true}

# /version
curl -s $PROD_URL/version
# 期待: {"spec":"plan_v2","app":"houkochan"}
```

---

## 確認結果

| エンドポイント | 期待値 | 結果 |
|----------------|--------|------|
| GET /health | `{"ok":true}` (HTTP 200) | 本番デプロイ後に確認 |
| GET /version | `{"spec":"plan_v2","app":"houkochan"}` (HTTP 200) | 本番デプロイ後に確認 |

---

## 次のアクション

1. 本番URLが判明したら、OPS-2（本番スモークテスト）を実施
2. Google OAuthを設定する場合は、GOOGLE_REDIRECT_URIを本番URLに合わせて設定

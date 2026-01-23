# CKPT_OPS_01: mainブランチへのマージPR作成

## 目的

実装ブランチをmainにマージ可能な形に整備し、PRを作成する。

## 確認日時

2026-01-23 14:26 UTC

---

## 1. 実装ブランチ

| 項目 | 値 |
|------|-----|
| ブランチ名 | `devin/1769132858-s1a-backend-minimal` |
| 最新コミット | `824ecfd` |
| コミット数 | 約20コミット（S-1A〜S-3、OPS-0） |

---

## 2. コンフリクト確認

- mainブランチ: `d8d450b`（仕様書のみ）
- コンフリクト: **なし**
- マージ方式: Fast-forward可能

---

## 3. PRリンク

**https://github.com/tkgathr2/security-report-system/pull/2**

- タイトル: "Deploy: merge implementation into main for production"
- ベースブランチ: `main`
- ヘッドブランチ: `devin/1769132858-s1a-backend-minimal`
- CI: 設定なし

---

## 4. 本番デプロイに必要なENV一覧

### 必須

| 変数名 | 用途 | 備考 |
|--------|------|------|
| `DATABASE_URL` | PostgreSQL接続文字列 | Railway PostgreSQLアドオンで自動設定 |
| `JWT_SECRET` | キャストJWT署名キー | 32文字以上推奨 |
| `AUTH_SECRET` | セッション暗号化キー | 32文字以上推奨 |

### Google OAuth（管理者ログイン用）

| 変数名 | 用途 |
|--------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth クライアントID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth クライアントシークレット |
| `GOOGLE_REDIRECT_URI` | OAuthコールバックURL（例: `https://{domain}/api/admin/auth/google/callback`） |

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

## 5. マージ後に本番で確認するURL一覧

| エンドポイント | 期待レスポンス |
|----------------|----------------|
| `GET /health` | `{"ok":true}` (HTTP 200) |
| `GET /version` | `{"spec":"plan_v2","app":"houkochan"}` (HTTP 200) |

### 追加確認（任意）

| エンドポイント | 期待動作 |
|----------------|----------|
| `GET /api/admin/auth/google/start` | OAuth未設定時: 503、設定済み: 302リダイレクト |
| `POST /api/auth/register` | キャスト登録（201） |

---

## 6. Railwayデプロイ手順（概要）

1. Railwayでプロジェクト作成
2. PostgreSQLアドオン追加
3. GitHubリポジトリ連携（mainブランチ）
4. 環境変数設定（上記一覧）
5. ビルド設定:
   - Root Directory: `backend`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
6. デプロイ実行
7. `/health` `/version` 確認

---

## 7. 次のアクション

1. PR #2 をレビュー・マージ
2. Railwayで初回デプロイ
3. 本番URL取得後、OPS-1（本番ENV確認）へ進行

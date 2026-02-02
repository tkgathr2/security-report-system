# CKPT_OPS_01: Railwayデプロイ調整

## 目的

Railway（monorepo）で確実にbackendがビルド・起動できるように、最小のデプロイ調整を入れる。

## 確認日時

2026-01-23 15:14 UTC

---

## 変更点一覧

### 1. PORT環境変数対応（既存で対応済み）

**backend/src/index.ts**
```typescript
const PORT = process.env.PORT || 3000;
// ...
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
```

- `process.env.PORT`を優先して使用
- 未設定時は3000にフォールバック
- Railwayが自動設定するPORTで起動可能

### 2. package.json scripts整備

**backend/package.json**
```json
"scripts": {
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "ts-node src/index.ts",
  "migrate": "node-pg-migrate",
  "migrate:up": "node-pg-migrate up"
}
```

- `build`: TypeScriptコンパイル
- `start`: 本番起動
- `migrate:up`: マイグレーション実行（追加）

### 3. Railway設定ファイル追加

**railway.json**（リポジトリルートに配置）
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "cd backend && npm install && npm run build"
  },
  "deploy": {
    "startCommand": "cd backend && npm run migrate:up && npm start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

---

## 想定するRailwayの動き

1. **ビルドフェーズ**
   - `railway.json`を検出
   - NIXPACKSビルダーを使用
   - `cd backend && npm install && npm run build`を実行
   - `backend/dist/`にコンパイル済みJSを生成

2. **デプロイフェーズ**
   - `cd backend && npm run migrate:up && npm start`を実行
   - マイグレーションを適用後、サーバー起動
   - `/health`でヘルスチェック（30秒タイムアウト）

3. **backendがビルド対象になる理由**
   - `railway.json`の`buildCommand`で明示的に`cd backend`を指定
   - monorepo構成でもbackendディレクトリを起点にビルド・起動

---

## ローカル確認結果

| 項目 | コマンド | 結果 |
|------|----------|------|
| ビルド | `npm run build` | 成功（dist/生成） |
| 起動（PORT指定） | `PORT=4000 npm start` | 成功（port 4000で起動） |
| /health | `curl localhost:4000/health` | `{"ok":true}` (HTTP 200) |
| /version | `curl localhost:4000/version` | `{"spec":"plan_v2","app":"houkochan"}` (HTTP 200) |

---

## 本番での確認URL

| エンドポイント | 期待レスポンス |
|----------------|----------------|
| `GET /health` | `{"ok":true}` (HTTP 200) |
| `GET /version` | `{"spec":"plan_v2","app":"houkochan"}` (HTTP 200) |

---

## 必要な環境変数（Railway設定）

| 変数名 | 必須 | 用途 |
|--------|------|------|
| `DATABASE_URL` | 必須 | PostgreSQL接続（Railwayアドオンで自動設定） |
| `JWT_SECRET` | 必須 | キャストJWT署名キー |
| `AUTH_SECRET` | 必須 | セッション暗号化キー |
| `GOOGLE_OAUTH_CLIENT_ID` | 任意 | Google OAuth |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 任意 | Google OAuth |
| `GOOGLE_OAUTH_REDIRECT_URL` | 任意 | OAuth callback URL |
| `SMTP_*` | 任意 | メール通知 |
| `SLACK_WEBHOOK_URL` | 任意 | Slack通知 |

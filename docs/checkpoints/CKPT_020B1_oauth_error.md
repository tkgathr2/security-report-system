# CHECKPOINT_020B1: OAuth未設定時エラーハンドリング修正

実行日時: 2026-01-23 03:22 UTC

## 1. 修正内容

### 1-1. 変更前
```json
HTTP 500
{
  "error": "INTERNAL_ERROR",
  "message": "Google OAuth is not configured",
  "details": {}
}
```

### 1-2. 変更後
```json
HTTP 503
{
  "error": "OAUTH_NOT_CONFIGURED",
  "message": "Google OAuth認証が設定されていません。環境変数 GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を設定してください。",
  "details": {
    "missing": ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]
  }
}
```

## 2. 実行したコマンド

### 2-1. GET /api/admin/auth/google/start（OAuth未設定時）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/admin/auth/google/start
```

## 3. 返ってきたレスポンス

### 3-1. GET /api/admin/auth/google/start（503 - OAuth未設定）
```json
{"error":"OAUTH_NOT_CONFIGURED","message":"Google OAuth認証が設定されていません。環境変数 GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を設定してください。","details":{"missing":["GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET"]}}
HTTP_CODE:503
```

### 3-2. /health（200）
```json
{"ok":true}
```

### 3-3. /version（200）
```json
{"spec":"plan_v2","app":"security-report-system"}
```

## 4. 修正理由

- 500 Internal Server Error は汎用的なサーバーエラーで、原因が不明確
- 503 Service Unavailable は「サービスが利用できない」ことを明示
- エラーコード OAUTH_NOT_CONFIGURED で設定不足であることを明確化
- details.missing で不足している環境変数を具体的に提示

## 成功条件確認

- [x] OAuth未設定時に 500 ではなく 503 を返す
- [x] エラーコードが OAUTH_NOT_CONFIGURED で設定不足が分かる
- [x] 不足している環境変数が details.missing で分かる
- [x] /health が 200 を返す
- [x] /version が 200 を返す

# CHECKPOINT_020A: キャスト認証API

実行日時: 2026-01-23 02:50 UTC

## 1. 実行したコマンド

### 1-1. curl register（201）
```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","pin":"1234"}'
```

### 1-2. curl login 成功（200）
```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","pin":"1234"}'
```

### 1-3. curl login 誤PIN（401）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","pin":"9999"}'
```

## 2. 返ってきたレスポンス

### 2-1. register（201）
```json
{
  "user": {
    "id": "d0acbe96-4aeb-470d-a62e-b5c272b63aea",
    "email": "test@example.com",
    "created_at": "2026-01-23T02:49:39.856Z"
  },
  "token": "[TOKEN_REDACTED]"
}
```

### 2-2. login 成功（200）
```json
{
  "user": {
    "id": "d0acbe96-4aeb-470d-a62e-b5c272b63aea",
    "email": "test@example.com",
    "created_at": "2026-01-23T02:49:39.856Z"
  },
  "token": "[TOKEN_REDACTED]"
}
```

### 2-3. login 誤PIN（401）
```json
{
  "error": "UNAUTHORIZED",
  "message": "メールアドレスまたはPINが正しくありません",
  "details": {}
}
HTTP_CODE:401
```

## 3. DB確認

### 3-1. cast_users の該当emailが存在すること
```bash
psql -d security_report_system -c "SELECT id, email, created_at FROM cast_users WHERE email = 'test@example.com'"
```

結果:
```
                  id                  |      email       |         created_at         
--------------------------------------+------------------+----------------------------
 d0acbe96-4aeb-470d-a62e-b5c272b63aea | test@example.com | 2026-01-23 02:49:39.856899
(1 row)
```

## 4. /health と /version のcurl結果

### 4-1. /health
```bash
curl -s http://localhost:3000/health
```
結果:
```json
{"ok":true}
```

### 4-2. /version
```bash
curl -s http://localhost:3000/version
```
結果:
```json
{"spec":"plan_v2","app":"security-report-system"}
```

## 成功条件確認

- [x] POST /api/auth/register が 201 を返す
- [x] POST /api/auth/login が正しいPINで 200 を返す
- [x] POST /api/auth/login が誤PINで 401 を返す
- [x] cast_users テーブルにユーザーが作成されている
- [x] /health が 200 を返す
- [x] /version が 200 を返す

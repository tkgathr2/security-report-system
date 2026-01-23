# CHECKPOINT_020B: 管理者Google OAuth + 許可リスト

実行日時: 2026-01-23 03:06 UTC

## 1. 実行したコマンド

### 1-1. GET /api/admin/auth/google/start（Google OAuth未設定時）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/admin/auth/google/start
```

### 1-2. GET /api/admin/me（セッションなし）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/admin/me
```

### 1-3. /health
```bash
curl -s http://localhost:3000/health
```

### 1-4. /version
```bash
curl -s http://localhost:3000/version
```

## 2. 返ってきたレスポンス

### 2-1. GET /api/admin/auth/google/start（500 - OAuth未設定）
```json
{"error":"INTERNAL_ERROR","message":"Google OAuth is not configured","details":{}}
HTTP_CODE:500
```
※ Google OAuth環境変数が設定されていない場合の正常な挙動

### 2-2. GET /api/admin/me（401 - セッションなし）
```json
{"error":"ADMIN_UNAUTHORIZED","message":"管理者セッションがありません","details":{}}
HTTP_CODE:401
```

### 2-3. /health（200）
```json
{"ok":true}
```

### 2-4. /version（200）
```json
{"spec":"plan_v2","app":"security-report-system"}
```

## 3. DB確認

### 3-1. admin_allowlist に初期管理者が存在すること
```bash
psql -d security_report_system -c "SELECT email, is_active FROM admin_allowlist"
```

結果:
```
       email        | is_active 
--------------------+-----------
 atsuhiro@takagi.bz | t
(1 row)
```

## 4. 実装内容

### 4-1. 実装したAPI
- GET /api/admin/auth/google/start（Googleへリダイレクト）
- GET /api/admin/auth/google/callback（セッション確立）
- GET /api/admin/me（ログイン状態確認）

### 4-2. 認可仕様
- Googleログイン後、Googleのメールアドレスが admin_allowlist に存在し、かつ is_active=true の場合のみ管理者として認可
- 許可リストに存在しない場合: 403 FORBIDDEN
- セッションがない場合: 401 ADMIN_UNAUTHORIZED

### 4-3. 環境変数（.env.example）
- GOOGLE_OAUTH_CLIENT_ID=REPLACE_WITH_SECRET
- GOOGLE_OAUTH_CLIENT_SECRET=REPLACE_WITH_SECRET
- GOOGLE_OAUTH_REDIRECT_URL=https://REPLACE_WITH_HOST/api/admin/auth/google/callback

## 成功条件確認

- [x] GET /api/admin/auth/google/start が実装されている（OAuth未設定時は500）
- [x] GET /api/admin/auth/google/callback が実装されている
- [x] GET /api/admin/me が 401 ADMIN_UNAUTHORIZED を返す（セッションなし時）
- [x] admin_allowlist による認可チェックが実装されている
- [x] 許可リストに atsuhiro@takagi.bz が存在する
- [x] /health が 200 を返す
- [x] /version が 200 を返す

## 備考

Google OAuth の実際の動作確認は、本番環境で GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を設定後に実施する必要があります。現在の実装では、環境変数が設定されていない場合は適切なエラーメッセージを返します。

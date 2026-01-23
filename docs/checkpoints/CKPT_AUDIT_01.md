# CHECKPOINT_AUDIT_01: システム監査

実行日時: 2026-01-23 03:32 UTC

## 1. DB監査

### 1-1. 全テーブル一覧
```sql
\dt
```
結果:
```
 Schema |       Name       | Type  | Owner  
--------+------------------+-------+--------
 public | admin_allowlist  | table | ubuntu
 public | admin_audit_logs | table | ubuntu
 public | cast_users       | table | ubuntu
 public | clients          | table | ubuntu
 public | csv_imports      | table | ubuntu
 public | pgmigrations     | table | ubuntu
 public | project_casts    | table | ubuntu
 public | projects         | table | ubuntu
 public | report_drafts    | table | ubuntu
 public | reports          | table | ubuntu
(10 rows)
```

### 1-2. reportsの必須カラム確認
```sql
\d reports
```
結果:
```
        Column         |            Type             | Collation | Nullable |      Default       
 signature_png         | bytea                       |           | not null | 
 pdf_bytes             | bytea                       |           | not null | 
 pdf_generation_status | text                        |           | not null | 'success'::text
 pdf_generated_at      | timestamp without time zone |           |          | 
```
- [x] pdf_bytes (bytea, NOT NULL)
- [x] signature_png (bytea, NOT NULL)
- [x] pdf_generation_status (text, NOT NULL, default 'success')
- [x] pdf_generated_at (timestamp, NULL可)

### 1-3. 主要UNIQUE制約確認
```sql
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename IN ('projects', 'admin_allowlist', 'project_casts') 
AND indexdef LIKE '%UNIQUE%';
```
結果:
```
                indexname                 |                                                        indexdef                                                         
------------------------------------------+-------------------------------------------------------------------------------------------------------------------------
 admin_allowlist_email_key                | CREATE UNIQUE INDEX admin_allowlist_email_key ON public.admin_allowlist USING btree (email)
 projects_project_key_key                 | CREATE UNIQUE INDEX projects_project_key_key ON public.projects USING btree (project_key)
 projects_unique_url_key                  | CREATE UNIQUE INDEX projects_unique_url_key ON public.projects USING btree (unique_url)
 project_casts_project_id_staff_no_unique | CREATE UNIQUE INDEX project_casts_project_id_staff_no_unique ON public.project_casts USING btree (project_id, staff_no)
```
- [x] projects.project_key (UNIQUE)
- [x] projects.unique_url (UNIQUE)
- [x] admin_allowlist.email (UNIQUE)
- [x] project_casts(project_id, staff_no) (UNIQUE)

### 1-4. seed済み管理者確認
```sql
SELECT email, is_active FROM admin_allowlist WHERE email = 'atsuhiro@takagi.bz';
```
結果:
```
       email        | is_active 
--------------------+-----------
 atsuhiro@takagi.bz | t
(1 row)
```
- [x] atsuhiro@takagi.bz が存在し、is_active=true

## 2. API監査

### 2-1. /health と /version
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/health
```
結果:
```json
{"ok":true}
HTTP_CODE:200
```

```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/version
```
結果:
```json
{"spec":"plan_v2","app":"security-report-system"}
HTTP_CODE:200
```
- [x] /health → 200
- [x] /version → 200

### 2-2. キャスト認証

#### POST /api/auth/register（201）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"audit_test@example.com","pin":"5678"}'
```
結果:
```json
{"user":{"id":"af324351-b7d3-409c-8b64-91887867eae3","email":"audit_test@example.com","created_at":"2026-01-23T03:31:34.187Z"},"token":"[TOKEN_REDACTED]"}
HTTP_CODE:201
```

#### POST /api/auth/login 正しいPIN（200）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"audit_test@example.com","pin":"5678"}'
```
結果:
```json
{"user":{"id":"af324351-b7d3-409c-8b64-91887867eae3","email":"audit_test@example.com","created_at":"2026-01-23T03:31:34.187Z"},"token":"[TOKEN_REDACTED]"}
HTTP_CODE:200
```

#### POST /api/auth/login 誤PIN（401）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"audit_test@example.com","pin":"9999"}'
```
結果:
```json
{"error":"UNAUTHORIZED","message":"メールアドレスまたはPINが正しくありません","details":{}}
HTTP_CODE:401
```
- [x] /api/auth/register → 201
- [x] /api/auth/login（正しいPIN）→ 200
- [x] /api/auth/login（誤PIN）→ 401

### 2-3. 管理者認証

#### GET /api/admin/auth/google/start（503 - OAuth未設定）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/admin/auth/google/start
```
結果:
```json
{"error":"OAUTH_NOT_CONFIGURED","message":"Google OAuth認証が設定されていません。環境変数 GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を設定してください。","details":{"missing":["GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET"]}}
HTTP_CODE:503
```

#### GET /api/admin/me（401 - セッションなし）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/admin/me
```
結果:
```json
{"error":"ADMIN_UNAUTHORIZED","message":"管理者セッションがありません","details":{}}
HTTP_CODE:401
```
- [x] /api/admin/auth/google/start → 503（OAuth未設定時の正常挙動）
- [x] /api/admin/me → 401（セッションなし時）

## 3. 監査結果サマリー

### DB監査
| 項目 | 結果 |
|------|------|
| 全テーブル（9テーブル + pgmigrations） | OK |
| reports必須カラム | OK |
| 主要UNIQUE制約 | OK |
| seed済み管理者 | OK |

### API監査
| エンドポイント | 期待値 | 結果 |
|---------------|--------|------|
| GET /health | 200 | OK |
| GET /version | 200 | OK |
| POST /api/auth/register | 201 | OK |
| POST /api/auth/login（正） | 200 | OK |
| POST /api/auth/login（誤） | 401 | OK |
| GET /api/admin/auth/google/start | 503 | OK |
| GET /api/admin/me | 401 | OK |

## 4. 結論

全ての監査項目がパスしました。S-1A〜S-2B.1までの実装が仕様書どおりに動作していることを確認しました。

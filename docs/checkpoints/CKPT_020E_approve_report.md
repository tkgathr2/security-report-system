# CHECKPOINT_020E: 承認API（reports作成・署名PNG・PDF保存）

実行日時: 2026-01-23 12:35 UTC

## 1. 実装概要

承認APIで reports レコードを作成し、署名PNG（bytea）とPDF（bytea）をDBに保存できるようにしました。

### 対象エンドポイント
- POST /api/reports/approve

### 実装ファイル
| ファイル | 変更内容 |
|---------|---------|
| backend/src/routes/reports.ts | 新規作成 - 承認API |
| backend/src/index.ts | reportsルーターの追加 |

### 認証
- キャストJWT必須（未ログインは 401 UNAUTHORIZED）

### 入力（JSON）
- project_unique_url（必須）
- supervisor_name
- weather (sunny/cloudy/rain)
- guard_contents (配列, 1件以上必須)
- guard_other_text (任意)
- overtime_hours (0-10, 任意)
- has_qualifier (boolean)
- qualifier_name (has_qualifier=trueのとき必須)
- signature_png_base64（PNGのbase64、必須）

### 保存先（DB）
- reports テーブルに insert
  - signature_png: base64をdecodeしてbyteaへ
  - pdf_bytes: 仮PDF（PDFとして開けるバイト列）
  - status: approved
  - approved_at: now
  - pdf_generation_status: success
  - pdf_generated_at: now

## 2. curl手順

### Step 1: キャスト登録してtoken取得
```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"approve-test@example.com","pin":"1234"}'
```

レスポンス:
```json
{
  "user": {
    "id": "4125724c-8c1a-4c9c-abd2-89a48f95a29b",
    "email": "approve-test@example.com",
    "created_at": "2026-01-23T12:34:53.656Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Step 2: 承認API呼び出し
```bash
SIGNATURE_PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

curl -s -X POST http://localhost:3000/api/reports/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"project_unique_url\":\"test-active-url-001\",
    \"supervisor_name\":\"田中太郎\",
    \"weather\":\"sunny\",
    \"guard_contents\":[\"施設警備\",\"巡回警備\"],
    \"guard_other_text\":\"特記事項なし\",
    \"overtime_hours\":2,
    \"has_qualifier\":true,
    \"qualifier_name\":\"山田花子\",
    \"signature_png_base64\":\"$SIGNATURE_PNG\"
  }"
```

## 3. 201レスポンス例

```json
{
  "ok": true,
  "report_id": "cf323936-e760-47fd-a519-a2f1c061a195",
  "pdf_saved": true,
  "signature_saved": true
}
HTTP_CODE:201
```

## 4. psqlでの確認（signature_png/pdf_bytesがNULLでない証拠）

```sql
SELECT id, supervisor_name, writer_name, weather, guard_contents, status, approved_at, pdf_generation_status, 
  CASE WHEN signature_png IS NOT NULL THEN 'NOT NULL (' || length(signature_png) || ' bytes)' ELSE 'NULL' END as signature_png_status,
  CASE WHEN pdf_bytes IS NOT NULL THEN 'NOT NULL (' || length(pdf_bytes) || ' bytes)' ELSE 'NULL' END as pdf_bytes_status
FROM reports ORDER BY created_at DESC LIMIT 1;
```

結果:
```
                  id                  | supervisor_name |       writer_name        | weather |   guard_contents    |  status  |       approved_at       | pdf_generation_status | signature_png_status |   pdf_bytes_status   
--------------------------------------+-----------------+--------------------------+---------+---------------------+----------+-------------------------+-----------------------+----------------------+----------------------
 cf323936-e760-47fd-a519-a2f1c061a195 | 田中太郎        | approve-test@example.com | sunny   | {施設警備,巡回警備} | approved | 2026-01-23 12:35:26.975 | success               | NOT NULL (70 bytes)  | NOT NULL (455 bytes)
```

## 5. 403/410/400 の確認結果

### 認証なし → 401
```json
{"error":"UNAUTHORIZED","message":"認証が必要です","details":{}}
HTTP_CODE:401
```

### 署名なし → 400
```json
{"error":"INVALID_PAYLOAD","message":"署名は必須です","details":{}}
HTTP_CODE:400
```

### guard_contents空 → 400
```json
{"error":"INVALID_PAYLOAD","message":"警備内容は1件以上必須です","details":{}}
HTTP_CODE:400
```

### has_qualifier=true で qualifier_name空 → 400
```json
{"error":"INVALID_PAYLOAD","message":"資格者有の場合、資格者氏名は必須です","details":{}}
HTTP_CODE:400
```

### pending_client案件 → 403
```json
{"error":"FORBIDDEN","message":"未登録会社のため保留","details":{}}
HTTP_CODE:403
```

### 期限切れ案件 → 410
```json
{"error":"EXPIRED_URL","message":"期限切れ","details":{}}
HTTP_CODE:410
```

### 存在しない案件 → 404
```json
{"error":"NOT_FOUND","message":"案件が見つかりません","details":{}}
HTTP_CODE:404
```

## 6. テスト結果サマリー

| ケース | 条件 | 期待値 | 結果 |
|--------|------|--------|------|
| 認証なし | Authorizationヘッダーなし | 401 UNAUTHORIZED | OK |
| 署名なし | signature_png_base64なし | 400 INVALID_PAYLOAD | OK |
| guard_contents空 | 空配列 | 400 INVALID_PAYLOAD | OK |
| has_qualifier=true, qualifier_name空 | 資格者有で氏名なし | 400 INVALID_PAYLOAD | OK |
| pending_client案件 | status=pending_client | 403 FORBIDDEN | OK |
| 期限切れ案件 | url_expires_at < now | 410 EXPIRED_URL | OK |
| 存在しない案件 | unique_urlが存在しない | 404 NOT_FOUND | OK |
| 正常承認 | active案件で全項目入力 | 201 + report_id | OK |
| DB確認 | signature_png, pdf_bytes | NOT NULL | OK |

## 7. ロールバック手順

```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 8. 注意事項

- pdf_bytesは現在「仮PDF」（ダミー）を生成しています
- 正式なPDF生成は次フェーズで実装予定
- メール送信・Slack通知はS-2Gで実装予定

# CHECKPOINT_020C: 案件URL取得API実装

実行日時: 2026-01-23 12:23 UTC

## 1. 実装概要

案件URL（unique_url）から案件を取得し、状態に応じて正しいHTTPステータスを返すAPIを実装しました。

### 対象エンドポイント
- GET /api/projects/{unique_url}

### 実装ファイル
| ファイル | 変更内容 |
|---------|---------|
| backend/src/routes/projects.ts | 新規作成 - 案件取得API |
| backend/src/index.ts | projectsルーターの追加 |

### 仕様
- 認証不要（URLベース公開）
- キャスト・管理者認証とは独立

## 2. curlコマンド

### Test 1: 存在しないURL → 404
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/projects/non-existent-url
```

### Test 2: pending_client → 403
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/projects/test-pending-url-001
```

### Test 3: 期限切れ → 410
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/projects/test-expired-url-001
```

### Test 4: active → 200
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3000/api/projects/test-active-url-001
```

## 3. 各ケースのレスポンス例

### 3-1. 存在しないURL（404 NOT_FOUND）
```json
{
  "error": "NOT_FOUND",
  "message": "案件が見つかりません",
  "details": {}
}
HTTP_CODE:404
```

### 3-2. pending_client（403 FORBIDDEN）
```json
{
  "error": "FORBIDDEN",
  "message": "未登録会社のため保留",
  "details": {}
}
HTTP_CODE:403
```

### 3-3. 期限切れ（410 GONE）
```json
{
  "error": "EXPIRED_URL",
  "message": "期限切れ",
  "details": {}
}
HTTP_CODE:410
```

### 3-4. active（200 OK）
```json
{
  "project": {
    "id": "be3e4ca0-0251-4727-a818-04103e7150cc",
    "project_key": "TEST-ACTIVE-001",
    "client_name_raw": "テスト会社A",
    "work_date": "2026-01-25T00:00:00.000Z",
    "work_name": "警備業務",
    "location": "東京都渋谷区",
    "start_time": null,
    "end_time": null,
    "break_time": null,
    "work_title_raw": "施設警備",
    "qualifier_hint": null,
    "unique_url": "test-active-url-001",
    "status": "active"
  }
}
HTTP_CODE:200
```

## 4. テスト結果サマリー

| ケース | 条件 | 期待値 | 結果 |
|--------|------|--------|------|
| 存在しないURL | unique_urlが存在しない | 404 NOT_FOUND | OK |
| pending_client | status = pending_client | 403 FORBIDDEN | OK |
| 期限切れ | url_expires_at < now | 410 EXPIRED_URL | OK |
| active | status = active かつ有効期限内 | 200 OK | OK |

## 5. ロールバック手順

```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 6. 注意事項

- テストデータは以下のunique_urlで作成済み:
  - `test-active-url-001`: active案件（有効期限: 2026-01-28）
  - `test-pending-url-001`: pending_client案件
  - `test-expired-url-001`: 期限切れ案件（有効期限: 2026-01-22）

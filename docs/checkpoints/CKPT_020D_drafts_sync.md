# CHECKPOINT_020D: 下書き（drafts）同期API実装

実行日時: 2026-01-23 12:29 UTC

## 1. 実装概要

下書き（drafts）の保存と取得ができ、競合解決ルールが仕様どおりに動くAPIを実装しました。

### 対象エンドポイント
- PUT /api/drafts/{project_unique_url}
- GET /api/drafts/{project_unique_url}

### 実装ファイル
| ファイル | 変更内容 |
|---------|---------|
| backend/src/routes/drafts.ts | 新規作成 - 下書き保存・取得API |
| backend/src/index.ts | draftsルーターの追加 |

### 認証
- キャストJWT必須（未ログインは 401 UNAUTHORIZED）

### DB
- report_drafts テーブルを使用
  - project_id, cast_user_id, payload_json, client_updated_at, server_updated_at
  - UNIQUE(project_id, cast_user_id)

### 競合解決ルール
1. 受け取った payload に client_updated_at を含める
2. 既存draftがある場合：
   - client_updated_at が新しい方を採用
   - 同値なら server_updated_at が新しい方を採用
3. 更新時に server_updated_at は now にする

## 2. curl手順

### Step 1: キャスト登録してtoken取得
```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"draft-test@example.com","pin":"1234"}'
```

レスポンス:
```json
{
  "user": {
    "id": "0c1b67af-666d-460f-bc4b-1f7df6058ce7",
    "email": "draft-test@example.com",
    "created_at": "2026-01-23T12:29:19.470Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Step 2: 認証なしでPUT → 401
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X PUT http://localhost:3000/api/drafts/test-active-url-001 \
  -H "Content-Type: application/json" \
  -d '{"payload_json":{"test":"data"},"client_updated_at":"2026-01-23T12:00:00Z"}'
```

レスポンス:
```json
{"error":"UNAUTHORIZED","message":"認証が必要です","details":{}}
HTTP_CODE:401
```

### Step 3: 認証ありでPUT（初回）
```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X PUT http://localhost:3000/api/drafts/test-active-url-001 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"payload_json":{"supervisor":"田中","weather":"晴"},"client_updated_at":"2026-01-23T12:00:00Z"}'
```

レスポンス:
```json
{"ok":true,"server_updated_at":"2026-01-23T12:29:28.899Z"}
HTTP_CODE:200
```

### Step 4: GETで取得
```bash
curl -s http://localhost:3000/api/drafts/test-active-url-001 \
  -H "Authorization: Bearer $TOKEN"
```

レスポンス:
```json
{
  "payload_json": {"weather": "晴", "supervisor": "田中"},
  "client_updated_at": "2026-01-23T12:00:00.000Z",
  "server_updated_at": "2026-01-23T12:29:28.899Z"
}
```

## 3. 競合テストの手順と結果

### 競合テスト1: 古いclient_updated_atを送信 → 上書きされない

```bash
curl -s -X PUT http://localhost:3000/api/drafts/test-active-url-001 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"payload_json":{"supervisor":"古いデータ","weather":"雨"},"client_updated_at":"2026-01-23T11:00:00Z"}'
```

レスポンス:
```json
{
  "ok": false,
  "message": "競合により更新されませんでした（既存データの方が新しい）",
  "server_updated_at": "2026-01-23T12:29:28.899Z"
}
HTTP_CODE:200
```

確認（GETで内容が変わっていないことを確認）:
```json
{
  "payload_json": {"weather": "晴", "supervisor": "田中"},
  "client_updated_at": "2026-01-23T12:00:00.000Z",
  "server_updated_at": "2026-01-23T12:29:28.899Z"
}
```

### 競合テスト2: 新しいclient_updated_atを送信 → 上書きされる

```bash
curl -s -X PUT http://localhost:3000/api/drafts/test-active-url-001 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"payload_json":{"supervisor":"新しいデータ","weather":"曇"},"client_updated_at":"2026-01-23T13:00:00Z"}'
```

レスポンス:
```json
{"ok":true,"server_updated_at":"2026-01-23T12:29:40.103Z"}
HTTP_CODE:200
```

確認（GETで内容が更新されていることを確認）:
```json
{
  "payload_json": {"weather": "曇", "supervisor": "新しいデータ"},
  "client_updated_at": "2026-01-23T13:00:00.000Z",
  "server_updated_at": "2026-01-23T12:29:40.103Z"
}
```

## 4. テスト結果サマリー

| ケース | 条件 | 期待値 | 結果 |
|--------|------|--------|------|
| 認証なしPUT | Authorizationヘッダーなし | 401 UNAUTHORIZED | OK |
| 初回PUT | 新規draft作成 | 200 + ok:true | OK |
| GET | draft取得 | 200 + payload | OK |
| 古いclient_updated_at | 既存より古い | ok:false（上書きされない） | OK |
| 新しいclient_updated_at | 既存より新しい | ok:true（上書きされる） | OK |
| 存在しない案件GET | unique_urlが存在しない | 404 NOT_FOUND | OK |
| draftがないGET | 案件は存在するがdraftがない | 404 NOT_FOUND | OK |

## 5. ロールバック手順

```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

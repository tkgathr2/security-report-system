# CKPT_OPS_02: 本番スモークテスト

## 目的

本番環境で「CSV→案件→URL→承認→PDF→通知→管理UI」の一連フローが動作することを確認する。

## 確認日時

2026-01-23 15:23 UTC

---

## 前提条件

- OPS-1（本番ENV設定）が完了していること
- `/health` と `/version` が正常に返ること
- 本番URLが判明していること

---

## スモークテスト手順

### 1. 基本疎通確認

```bash
PROD_URL="https://{your-railway-domain}.up.railway.app"

# /health
curl -s $PROD_URL/health
# 期待: {"ok":true}

# /version
curl -s $PROD_URL/version
# 期待: {"spec":"plan_v2","app":"houkochan"}
```

### 2. 管理者ログイン

#### Google OAuth設定済みの場合
ブラウザで `$PROD_URL/api/admin/auth/google/start` にアクセスし、Googleログインを完了

#### テスト用（開発時のみ）
```bash
# テスト用admin-loginエンドポイント（本番では無効化推奨）
curl -s -c /tmp/prod_cookies.txt -X POST $PROD_URL/api/test/admin-login \
  -H "Content-Type: application/json" \
  -d '{"email":"atsuhiro@takagi.bz"}'
```

### 3. CSV取込テスト

```bash
# テストCSV作成
cat > /tmp/prod_test.csv << 'EOF'
No.,スタッフNo.,氏名,実施日,クライアント名,案件名,実施場所
1,S001,山田太郎,2026/01/24,テスト株式会社,本番テスト警備,東京都新宿区1-1-1
EOF

# CSV取込
curl -s -b /tmp/prod_cookies.txt -X POST $PROD_URL/api/admin/csv/import \
  -F "file=@/tmp/prod_test.csv"
# 期待: {"ok":true,"status":"success","created_projects_count":1,...}
```

### 4. 案件一覧確認

```bash
curl -s -b /tmp/prod_cookies.txt $PROD_URL/api/admin/projects | jq '.projects | length'
# 期待: 1以上
```

### 5. 案件URL取得テスト

```bash
# 案件のunique_urlを取得
UNIQUE_URL=$(curl -s -b /tmp/prod_cookies.txt $PROD_URL/api/admin/projects | jq -r '.projects[0].unique_url')

# active案件 → 200
curl -s -w "\nHTTP_CODE:%{http_code}" $PROD_URL/api/projects/$UNIQUE_URL
# 期待: HTTP_CODE:200
```

### 6. キャスト認証テスト

```bash
# キャスト登録
REGISTER_RESULT=$(curl -s -X POST $PROD_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"prod-test@example.com","pin":"1234"}')
echo $REGISTER_RESULT | jq .
TOKEN=$(echo $REGISTER_RESULT | jq -r '.token')
# 期待: token取得成功
```

### 7. 下書き保存テスト

```bash
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
curl -s -X PUT "$PROD_URL/api/drafts/$UNIQUE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"payload_json\":{\"supervisor_name\":\"本番テスト監督\"},\"client_updated_at\":\"$NOW\"}"
# 期待: {"ok":true,...}
```

### 8. 承認テスト

```bash
curl -s -X POST $PROD_URL/api/reports/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"project_unique_url\": \"$UNIQUE_URL\",
    \"supervisor_name\": \"本番テスト監督\",
    \"weather\": \"sunny\",
    \"guard_contents\": [\"patrol\"],
    \"overtime_hours\": 0,
    \"has_qualifier\": false,
    \"signature_png_base64\": \"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==\"
  }"
# 期待: {"ok":true,"report_id":"...","pdf_saved":true,"signature_saved":true,...}
```

### 9. 報告書一覧・PDFダウンロード

```bash
# 報告書一覧
curl -s -b /tmp/prod_cookies.txt $PROD_URL/api/admin/reports | jq '.reports | length'
# 期待: 1以上

# PDFダウンロード
REPORT_ID=$(curl -s -b /tmp/prod_cookies.txt $PROD_URL/api/admin/reports | jq -r '.reports[0].id')
curl -s -b /tmp/prod_cookies.txt "$PROD_URL/api/admin/reports/$REPORT_ID/pdf" -o /tmp/prod_report.pdf
ls -la /tmp/prod_report.pdf
# 期待: 10KB以上のPDFファイル
```

### 10. 通知確認

承認時のレスポンスで以下を確認:
- `notifications.email_sent`: SMTP設定済みならtrue、未設定ならfalse
- `notifications.slack_sent`: Slack設定済みならtrue、未設定ならfalse
- `warnings`: ENV未設定時は警告メッセージが含まれる

---

## 確認結果チェックリスト

| 項目 | 期待値 | 結果 |
|------|--------|------|
| /health | `{"ok":true}` | |
| /version | `{"app":"houkochan"}` | |
| CSV取込 | `ok:true` | |
| 案件一覧 | 1件以上 | |
| 案件URL取得 | HTTP 200 | |
| キャスト登録 | token取得 | |
| 下書き保存 | `ok:true` | |
| 承認 | `ok:true, pdf_saved:true` | |
| 報告書一覧 | 1件以上 | |
| PDFダウンロード | >10KB | |

---

## 管理者UI確認（ブラウザ）

1. `$PROD_URL` にアクセス
2. Googleログイン（または管理者セッション確立）
3. CSV取込画面 → ファイル選択 → 取込実行
4. 案件一覧 → 案件が表示される
5. 報告書一覧 → PDFダウンロードボタンが動作する

---

## 次のアクション

- 全項目OKなら、OPS-3（運用手順Runbook）へ進む
- NGがあれば、最小修正点を特定して対応

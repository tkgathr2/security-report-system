# CKPT_020G: 通知機能実装（メール+Slack）

## 目的
承認API（POST /api/reports/approve）の承認後に、クライアントへのメール通知と社内Slack通知を送信する機能を実装する。

## 変更点

### 新規ファイル
- `backend/src/services/notifications.ts` - 通知サービス（メール送信、Slack通知）

### 変更ファイル
- `backend/src/routes/reports.ts` - 承認後に通知を送信するよう統合
- `backend/package.json` - nodemailer, @types/nodemailerの追加

## 必要な環境変数

### メール送信（SMTP）
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@example.com
```

### Slack通知
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

**注意**: 実値はコミットしないでください。.envファイルで管理し、.gitignoreに含めてください。

## 実装内容

### メール送信
- トリガー: 承認後
- 宛先: clients.emails（複数宛先対応）
- 添付: PDF（pdf_bytes）
- 失敗時: 処理継続、warningsとして返却

### Slack通知
- トリガー: 承認後
- 内容: 会社名、実施日、案件名、報告書ID
- 失敗時: ログのみ、処理継続

### レスポンス拡張
```json
{
  "ok": true,
  "report_id": "...",
  "pdf_saved": true,
  "signature_saved": true,
  "notifications": {
    "email_sent": false,
    "slack_sent": false
  },
  "warnings": ["メール送信失敗: SMTP not configured", "Slack通知失敗: Slack webhook not configured"]
}
```

## 動作確認手順

### 1. キャストユーザー登録
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","pin":"1234"}' | jq -r '.token')
```

### 2. 承認API実行（通知機能付き）
```bash
curl -X POST http://localhost:3000/api/reports/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "project_unique_url": "<active_project_url>",
    "supervisor_name": "田中監督",
    "weather": "sunny",
    "guard_contents": ["patrol", "access_control"],
    "has_qualifier": false,
    "signature_png_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  }'
```

## テスト結果

### 正常系（ENV未設定時）
```
レスポンス (201):
{
  "ok": true,
  "report_id": "260d4a76-abd5-4df7-b17e-aedfb33161be",
  "pdf_saved": true,
  "signature_saved": true,
  "notifications": {
    "email_sent": false,
    "slack_sent": false
  },
  "warnings": [
    "メール送信失敗: SMTP not configured",
    "Slack通知失敗: Slack webhook not configured"
  ]
}
```

### サーバーログ確認
```
[EMAIL] SMTP not configured, skipping email send
[EMAIL] Would send to: test@example.com
[EMAIL] Subject: 【警備報告書】施設警備A (2026-01-25)
[SLACK] Webhook URL not configured, skipping Slack notification
[SLACK] Would send: {
  "companyName": "テスト株式会社",
  "workDate": "2026-01-25",
  "projectName": "施設警備A",
  "reportId": "260d4a76-abd5-4df7-b17e-aedfb33161be"
}
```

### 確認ポイント
1. 承認処理自体は成功（201）
2. 通知関数が呼ばれていることをログで確認
3. ENV未設定時は送信スキップ、warningsで通知
4. 送信先、件名、内容がログに出力される

## 本番環境での確認手順

1. .envにSMTP設定を追加
2. .envにSlack Webhook URLを追加
3. サーバー再起動
4. 承認APIを実行
5. メール受信確認
6. Slackチャンネル確認

## ロールバック手順
```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 完了状態
- S-2E: 承認API（reports作成+BLOB保存）完了
- S-2F: CSV取込（案件生成+pending_client）完了
- S-2G: 通知（メール+Slack）完了

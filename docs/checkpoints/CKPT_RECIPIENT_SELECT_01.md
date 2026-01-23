# CKPT_RECIPIENT_SELECT_01: 宛先選択機能

## 1. 目的

送信（または共有）前に、送付先（会社名・担当者名・メール）を安全に選択できるUI/APIを実装する。
同一会社名でも担当者が複数いるケースに対応し、担当者単位でチェックボックス選択できるようにする。

## 2. UI仕様（スクリーン構造）

### 2.1 画面構成
- **ヘッダー**: 「送付先選択」タイトル
- **検索ボックス**: 会社名・担当者名・メールで絞り込み
- **会社グループリスト**: 
  - 会社名でグルーピング
  - 折りたたみ表示（▼アイコンで展開/折りたたみ）
  - 会社単位のチェックボックス（配下を一括ON/OFF）
  - 担当者単位のチェックボックス
- **選択済みサマリパネル**（画面下部固定）:
  - 選択件数
  - ユニークメール件数
  - メール一覧（重複排除後）
  - 保存ボタン

### 2.2 機能
1. 会社名でグルーピングし、折りたたみ表示
2. 担当者単位でチェックボックス選択
3. 会社単位のチェック（配下を一括ON/OFF）
4. 検索ボックスで「会社名 / 担当者名 / メール」を絞り込み
5. 画面下部に「選択済み宛先サマリ」を常時表示

## 3. API仕様

### 3.1 GET /api/admin/recipients
送付先一覧を取得（会社名でグルーピング）

**リクエスト**: なし（管理者セッション必須）

**レスポンス（200）**:
```json
{
  "recipients": [
    {
      "id": "uuid",
      "company_name": "株式会社ABC",
      "contact_name": "田中太郎",
      "email": "tanaka@abc.co.jp",
      "is_active": true,
      "created_at": "2026-01-23T10:18:52.010Z",
      "updated_at": "2026-01-23T10:18:52.010Z"
    }
  ],
  "grouped": {
    "株式会社ABC": [...]
  },
  "total_count": 3,
  "company_count": 2
}
```

**エラー（401）**: 管理者セッションなし
```json
{
  "error": "ADMIN_UNAUTHORIZED",
  "message": "管理者セッションがありません",
  "details": {}
}
```

### 3.2 POST /api/admin/recipients
新規送付先を登録

**リクエスト**:
```json
{
  "company_name": "株式会社ABC",
  "contact_name": "田中太郎",
  "email": "tanaka@abc.co.jp"
}
```

**レスポンス（201）**: 登録成功
**エラー（400）**: バリデーションエラー
**エラー（409）**: 重複エラー

### 3.3 POST /api/admin/recipients/for-report/:reportId
報告書に宛先を保存

**リクエスト**:
```json
{
  "recipient_ids": ["uuid1", "uuid2"]
}
```

**レスポンス（200）**:
```json
{
  "message": "宛先を保存しました",
  "report_id": "uuid",
  "recipients": [...],
  "recipient_count": 2,
  "unique_email_count": 2,
  "unique_emails": ["tanaka@abc.co.jp", "yamada@xyz.co.jp"]
}
```

**エラー（404）**: 報告書が見つからない

### 3.4 GET /api/admin/recipients/for-report/:reportId
報告書に紐づいた宛先を取得

**レスポンス（200）**:
```json
{
  "report_id": "uuid",
  "recipients": [...],
  "grouped": {...},
  "recipient_count": 2,
  "unique_email_count": 2,
  "unique_emails": [...]
}
```

## 4. DB設計

### 4.1 新規テーブル

#### recipients（送付先マスタ）
```sql
CREATE TABLE recipients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_name, contact_name, email)
);
CREATE INDEX recipients_company_name_index ON recipients (company_name);
```

#### report_recipients（報告書-送付先紐付け）
```sql
CREATE TABLE report_recipients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, recipient_id)
);
CREATE INDEX report_recipients_report_id_index ON report_recipients (report_id);
CREATE INDEX report_recipients_recipient_id_index ON report_recipients (recipient_id);
```

### 4.2 email正規化
- 保存前に必ず `trim() + toLowerCase()` を適用
- DB拡張（citext）は使用せず、アプリ側で統一

## 5. 動作確認結果

### 5.1 API動作確認

#### 未ログイン時（401）
```bash
$ curl -s http://localhost:3000/api/admin/recipients
{"error":"ADMIN_UNAUTHORIZED","message":"管理者セッションがありません","details":{}}
```

#### 管理者ログイン後

**送付先一覧取得**:
```bash
$ curl -s -b /tmp/cookies.txt http://localhost:3000/api/admin/recipients
{
  "recipients": [...],
  "grouped": {"株式会社ABC": [...], "株式会社XYZ": [...]},
  "total_count": 4,
  "company_count": 3
}
```

**送付先登録**:
```bash
$ curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/admin/recipients \
  -H "Content-Type: application/json" \
  -d '{"company_name": "株式会社ABC", "contact_name": "田中太郎", "email": "tanaka@abc.co.jp"}'
{"message":"送付先を登録しました","recipient":{"id":"...",...}}
```

**報告書に宛先保存**:
```bash
$ curl -s -b /tmp/cookies.txt -X POST "http://localhost:3000/api/admin/recipients/for-report/$REPORT_ID" \
  -H "Content-Type: application/json" \
  -d '{"recipient_ids": ["uuid1", "uuid2"]}'
{"message":"宛先を保存しました","report_id":"...","recipient_count":2,"unique_email_count":2}
```

**報告書の宛先取得**:
```bash
$ curl -s -b /tmp/cookies.txt "http://localhost:3000/api/admin/recipients/for-report/$REPORT_ID"
{"report_id":"...","recipients":[...],"grouped":{...},"recipient_count":2}
```

### 5.2 UI動作確認

1. 未ログイン時: 「ログインが必要です」エラー表示
2. ログイン後: 会社グルーピング表示
3. 担当者チェックボックス: 個別選択可能
4. 会社チェックボックス: 配下一括ON/OFF
5. 検索機能: 会社名・担当者名・メールで絞り込み
6. 選択済みサマリ: 件数・ユニークメール表示
7. 保存機能: 「宛先を保存しました（N件、ユニークメールM件）」表示

### 5.3 email重複排除確認
同一メールアドレスを持つ異なるrecipientを選択した場合、サーバー側で重複排除される。

## 6. ロールバック手順

```bash
# 1. コミットを確認
git log --oneline -5

# 2. CKPT_RECIPIENT_SELECT_01 のコミットを特定し、その前のコミットにリセット
git revert <RECIPIENT_SELECT_01_commit_hash>

# 3. マイグレーションをロールバック
cd backend
npm run migrate down -- --count 2

# 4. 変更をプッシュ
git push origin devin/1769132858-s1a-backend-minimal
```

## 7. 変更ファイル一覧

### バックエンド
- `backend/migrations/1737598984000_create-recipients-table.js` (新規)
- `backend/migrations/1737598985000_create-report-recipients-table.js` (新規)
- `backend/src/routes/adminRecipients.ts` (新規)
- `backend/src/index.ts` (adminRecipientsRouter追加)

### フロントエンド
- `frontend/` (新規ディレクトリ)
  - `package.json`
  - `vite.config.ts`
  - `tsconfig.json`
  - `tsconfig.node.json`
  - `index.html`
  - `src/main.tsx`
  - `src/App.tsx`
  - `src/index.css`
  - `src/vite-env.d.ts`

## 8. 次のフェーズへの注意

- メール送信機能は**このフェーズでは実装していない**（誤送信防止のため）
- 次フェーズで送信機能を実装する際は、選択済み宛先を使用する

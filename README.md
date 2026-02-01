# デジタル警備報告書システム【ほうこちゃん】

警備会社向けのデジタル報告書作成・管理システムです。

## 概要

「デジタル警備報告書システム【ほうこちゃん】」は、警備業務の報告書をデジタル化し、効率的な作成・承認・送付を実現するシステムです。

## 主な機能

- **案件管理**: CSVインポートによる案件一括登録
- **報告書作成**: キャストによる報告書入力・署名
- **PDF生成**: 日本語対応の報告書PDF自動生成
- **通知機能**: メール・Slack連携による承認通知
- **管理者UI**: Web画面での案件・報告書管理

## 技術スタック

### バックエンド
- Node.js + Express + TypeScript
- PostgreSQL
- pdfkit（PDF生成）
- nodemailer（メール送信）

### フロントエンド
- Vite + React + TypeScript

## セットアップ

### バックエンド
```bash
cd backend
npm install
cp .env.example .env  # 環境変数を設定
npm run dev
```

### フロントエンド
```bash
cd frontend
npm install
npm run dev
```

## 環境変数

### 必須
- `DATABASE_URL`: PostgreSQL接続文字列
- `AUTH_SECRET`: セッション暗号化キー

### オプション（通知機能）
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: メール送信設定
- `SLACK_WEBHOOK_URL`: Slack通知用Webhook URL

### オプション（OAuth）
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: Google OAuth設定

## API エンドポイント

- `GET /health` - ヘルスチェック
- `GET /version` - バージョン情報
- `POST /api/auth/register` - キャスト登録
- `POST /api/auth/login` - キャストログイン
- `GET /api/projects/{unique_url}` - 案件取得
- `PUT /api/drafts/{unique_url}` - 下書き保存
- `POST /api/reports/approve` - 報告書承認
- `POST /api/admin/csv/import` - CSV取込
- `GET /api/admin/projects` - 案件一覧
- `GET /api/admin/reports` - 報告書一覧

## ライセンス

Proprietary

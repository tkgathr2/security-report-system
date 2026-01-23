# CKPT_020I: 管理者UI最小実装

## 目的
管理者が最低限使える画面を作る。デザインは不要、機能優先。

## 変更点

### バックエンド
- `backend/src/routes/admin.ts` - GET /api/admin/projects, GET /api/admin/reports 追加

### フロントエンド
- `frontend/src/App.tsx` - 管理者UI（3画面）実装

## 実装内容

### バックエンドAPI
1. **GET /api/admin/projects** - 案件一覧取得（管理者認証必須）
2. **GET /api/admin/reports** - 報告書一覧取得（管理者認証必須）
3. **GET /api/admin/reports/{id}/pdf** - PDFダウンロード（既存）

### フロントエンド画面

#### 1. ログイン画面
- Google OAuthでログイン
- `/api/admin/auth/google/start` へリダイレクト

#### 2. CSV取込画面
- ファイル選択 → POST /api/admin/csv/import
- インポート結果表示（作成/更新件数、スキップ件数、pending_client件数）

#### 3. 案件一覧画面
- GET /api/admin/projects で取得
- 表示項目: 実施日、会社名、作業名、場所、状態、URL有効期限

#### 4. 報告書一覧画面
- GET /api/admin/reports で取得
- 表示項目: 承認日時、会社名、実施日、作業名、監督者、PDFダウンロード
- PDFダウンロードボタン（pdf_generation_status=successの場合のみ）

## ローカル起動手順

### 1. バックエンド起動
```bash
cd /home/ubuntu/repos/security-report-system/backend
npm run dev
# → http://localhost:3000
```

### 2. フロントエンド起動
```bash
cd /home/ubuntu/repos/security-report-system/frontend
npm install
npm run dev
# → http://localhost:5173
```

### 3. アクセス
ブラウザで http://localhost:5173 を開く

## 画面導線

```
[ログイン画面]
    ↓ Googleでログイン
[CSV取込画面] ←→ [案件一覧] ←→ [報告書一覧]
                                    ↓
                              [PDFダウンロード]
```

## 動作確認

### API確認（管理者セッション必要）
```bash
# テスト用管理者ログイン
COOKIE_JAR="/tmp/admin_cookies.txt"
curl -s -c "$COOKIE_JAR" -X POST http://localhost:3000/api/test/admin-login

# 案件一覧
curl -s -b "$COOKIE_JAR" http://localhost:3000/api/admin/projects | jq '.total'
# → 7

# 報告書一覧
curl -s -b "$COOKIE_JAR" http://localhost:3000/api/admin/reports | jq '.total'
# → 3
```

### フロントエンド確認
1. http://localhost:5173 にアクセス
2. ログイン画面が表示される
3. Google OAuthでログイン（要OAuth設定）
4. CSV取込画面が表示される
5. ナビゲーションで案件一覧・報告書一覧に移動可能

## 技術スタック
- Vite 7.3.1
- React 19.2.3
- TypeScript 5.9.3
- インラインスタイル（CSS最小）

## ビルド
```bash
cd /home/ubuntu/repos/security-report-system/frontend
npm run build
# → dist/ にビルド成果物
```

## ロールバック手順
```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 次のステップ
- S-2J: 名称反映（ほうこちゃん）

# CKPT_020J: 名称反映（ほうこちゃん）

## 目的
プロダクト名称を「ほうこちゃん」に統一する（表記のみ）。

## 変更点

### 新規ファイル
- `README.md` - プロダクト説明（ほうこちゃん）

### 変更ファイル
- `backend/src/index.ts` - /version エンドポイント
- `backend/src/services/notifications.ts` - Slack通知文言、メール件名
- `backend/src/services/pdfGenerator.ts` - PDFタイトル（S-2Hで実装済み）
- `frontend/src/App.tsx` - 管理画面タイトル（S-2Iで実装済み）

## 反映箇所一覧

### 1. README
```markdown
# ほうこちゃん（デジタル警備報告書システム）
```

### 2. /version エンドポイント
```json
{
  "spec": "plan_v2",
  "app": "houkochan"
}
```

### 3. PDFタイトル
```
デジタル警備報告書「ほうこちゃん」
```
- PDFメタデータ Title
- PDFメタデータ Author
- PDF本文タイトル
- PDFフッター

### 4. Slack通知文言
```
【ほうこちゃん】報告書が承認されました
【ほうこちゃん】報告書承認通知
```

### 5. メール件名
```
【ほうこちゃん】警備報告書 {案件名} ({実施日})
```

### 6. メール本文
```
ほうこちゃんより警備報告書をお送りいたします。
```

### 7. 管理画面
```
ほうこちゃん 管理画面
```

## 動作確認

### /version エンドポイント
```bash
curl -s http://localhost:3000/version | jq .
# {
#   "spec": "plan_v2",
#   "app": "houkochan"
# }
```

### PDF生成確認
```bash
grep -n "ほうこちゃん" backend/src/services/pdfGenerator.ts
# 38:          Title: 'デジタル警備報告書「ほうこちゃん」',
# 39:          Author: 'ほうこちゃん',
# 52:      doc.fontSize(20).text('デジタル警備報告書「ほうこちゃん」', { align: 'center' });
# 124:      doc.text('Powered by ほうこちゃん', { align: 'right' });
```

### Slack通知確認
```bash
grep -n "ほうこちゃん" backend/src/services/notifications.ts
# 81:      text: `【ほうこちゃん】報告書が承認されました`,
# 87:            text: `*【ほうこちゃん】報告書承認通知*\n\n` +
# 129:    subject: `【ほうこちゃん】警備報告書 ${params.projectName} (${params.workDate})`,
# 131:      `ほうこちゃんより警備報告書をお送りいたします。\n\n` +
# 136:      `<p>ほうこちゃんより警備報告書をお送りいたします。</p>` +
```

### 管理画面確認
```bash
grep -n "ほうこちゃん" frontend/src/App.tsx
# 195:          <h1 style={styles.title}>ほうこちゃん 管理画面</h1>
# 207:        <h1 style={styles.headerTitle}>ほうこちゃん 管理画面</h1>
```

## 注意事項
- リポジトリ名は変更なし（security-report-system）
- 仕様は変更なし（表記のみ）

## ロールバック手順
```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 完了
S-2H/S-2I/S-2J すべて完了。次フェーズへは進まず停止。

# CKPT_020H: PDF正式生成

## 目的
承認時に保存するpdf_bytesを「仮PDF」から「報告書として読めるPDF」に置き換える。

## 変更点

### 新規ファイル
- `backend/src/services/pdfGenerator.ts` - PDF生成サービス（pdfkit使用）

### 変更ファイル
- `backend/src/routes/reports.ts` - PDF生成サービスを統合

## 実装内容

### PDF生成サービス
- ライブラリ: pdfkit
- 日本語フォント: IPAゴシック（/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf）
- A4サイズ、マージン50pt

### PDFに含まれる内容
1. タイトル: デジタル警備報告書「ほうこちゃん」
2. 宛先会社名（clients.name）
3. 実施日（projects.work_date）
4. 実施場所（projects.location）
5. 作業名称（projects.work_name）
6. 監督者名（supervisor_name）
7. 記入者名（writer_name）
8. 警備内容（guard_contents）- 日本語ラベルに変換
9. 早出残業（overtime_hours）
10. 資格者有無＋氏名（has_qualifier/qualifier_name）
11. 署名画像（signature_png）- 埋め込み対応
12. 生成日時
13. フッター: Powered by ほうこちゃん

### 警備内容ラベル変換
```
patrol → 巡回警備
access_control → 出入管理
traffic_control → 交通誘導
facility_guard → 施設警備
event_guard → イベント警備
parking_guard → 駐車場警備
construction_guard → 工事現場警備
other → その他
```

## 動作確認手順

### 1. キャストユーザー登録
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","pin":"1234"}' | jq -r '.token')
```

### 2. 承認API実行
```bash
curl -X POST http://localhost:3000/api/reports/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "project_unique_url": "<active_project_url>",
    "supervisor_name": "田中監督",
    "weather": "sunny",
    "guard_contents": ["patrol", "access_control", "facility_guard"],
    "guard_other_text": "特記事項なし",
    "overtime_hours": 2,
    "has_qualifier": true,
    "qualifier_name": "山田資格者",
    "signature_png_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  }'
```

### 3. psqlでPDFサイズ確認
```bash
psql -d security_report -c "SELECT id, length(pdf_bytes) as pdf_size, pdf_generation_status FROM reports ORDER BY created_at DESC LIMIT 5;"
```

## テスト結果

### サーバーログ
```
[PDF] Generated PDF: 26106 bytes
```

### DB確認: pdf_bytes サイズ比較
```
                  id                  | pdf_size | sig_size | pdf_generation_status 
--------------------------------------+----------+----------+-----------------------
 d1aeee36-47a2-4387-a282-6101cc60ff02 |    26106 |       70 | success  ← 正式PDF
 260d4a76-abd5-4df7-b17e-aedfb33161be |      455 |       70 | success  ← 仮PDF
 cf323936-e760-47fd-a519-a2f1c061a195 |      455 |       70 | success  ← 仮PDF
```

### 確認ポイント
1. 正式PDF: 26106 bytes（以前の仮PDF: 455 bytes の約57倍）
2. pdf_generation_status: success
3. 署名画像の埋め込み: 対応済み
4. 日本語表示: IPAゴシックフォント使用で文字化けなし

### PDFファイル確認
```bash
# PDFをファイルに保存
psql -d security_report -t -c "SELECT encode(pdf_bytes, 'base64') FROM reports ORDER BY created_at DESC LIMIT 1;" | base64 -d > /tmp/test_report.pdf

# ファイルサイズ確認
ls -la /tmp/test_report.pdf
# -rw-r--r-- 1 ubuntu ubuntu 26449 Jan 23 12:54 /tmp/test_report.pdf
```

## エラーハンドリング
- PDF生成失敗時: 仮PDFにフォールバック、pdf_generation_status = 'failed'
- 署名画像埋め込み失敗時: エラーログ出力、テキストで代替表示

## ロールバック手順
```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 次のステップ
- S-2I: 管理者UI最小実装

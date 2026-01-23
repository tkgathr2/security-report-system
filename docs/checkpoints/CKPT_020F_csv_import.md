# CKPT_020F: CSV取込API実装

## 目的
CSV取込APIを実装し、案件（projects）とキャスト（project_casts）を生成する。未登録会社の場合はpending_clientステータスで保留する。

## 変更点

### 新規ファイル
- `backend/src/routes/adminCsvImport.ts` - CSV取込APIエンドポイント

### 変更ファイル
- `backend/src/index.ts` - adminCsvImportRouterの追加
- `backend/package.json` - csv-parse, multer, @types/multerの追加

## 実装内容

### POST /api/admin/csv/import
- 管理者認証必須（セッションベース）
- multipart/form-dataでCSVファイルを受信
- 文字コード自動判定（UTF-8 BOM/UTF-8/CP932）
- 必須ヘッダー検証
- 同一案件判定キー：実施日+案件名+実施場所+クライアント名（SHA256ハッシュ）
- 会社マスタ照合：clients.name_normalizedで照合
- 未登録会社の場合：projects.status = pending_client
- csv_importsに履歴保存

## curl手順

### 1. 管理者ログイン（テスト用）
```bash
COOKIE_JAR="/tmp/admin_cookies.txt"
curl -c "$COOKIE_JAR" -X POST http://localhost:3000/api/test/admin-login \
  -H "Content-Type: application/json"
```

### 2. CSV取込
```bash
curl -b "$COOKIE_JAR" -X POST http://localhost:3000/api/admin/csv/import \
  -F "file=@/path/to/import.csv"
```

## テスト結果

### 正常系：CSV取込成功
```
入力CSV:
No.,スタッフNo.,氏名,実施日,クライアント名,案件名,実施場所,業務内容(2),開始時間,終了時間,休憩時間
1,S001,山田太郎,2026/01/25,テスト株式会社,施設警備A,東京都渋谷区,施設警備,09:00,18:00,01:00
2,S002,佐藤花子,2026/01/25,テスト株式会社,施設警備A,東京都渋谷区,施設警備,09:00,18:00,01:00
3,S003,鈴木一郎,2026/01/25,未登録会社,イベント警備B,東京都新宿区,イベント警備,10:00,20:00,01:00
4,S004,田中次郎,2026/01/26,テスト株式会社,巡回警備C,東京都港区,巡回警備,08:00,17:00,01:00

レスポンス (200):
{
  "ok": true,
  "status": "success",
  "created_projects_count": 3,
  "skipped_rows_count": 0,
  "pending_client_rows_count": 1,
  "errors": []
}
```

### psql確認：projects増加
```sql
SELECT client_name_raw, work_date, status, client_id IS NOT NULL as has_client 
FROM projects WHERE project_key NOT LIKE 'TEST-%';

 client_name_raw | work_date  |     status     | has_client 
-----------------+------------+----------------+------------
 テスト株式会社  | 2026-01-26 | active         | t
 未登録会社      | 2026-01-25 | pending_client | f
 テスト株式会社  | 2026-01-25 | active         | t
```

### psql確認：project_casts増加
```sql
SELECT pc.staff_no, pc.cast_name, p.client_name_raw 
FROM project_casts pc JOIN projects p ON pc.project_id = p.id;

 staff_no | cast_name | client_name_raw 
----------+-----------+-----------------
 S004     | 田中次郎  | テスト株式会社
 S003     | 鈴木一郎  | 未登録会社
 S001     | 山田太郎  | テスト株式会社
 S002     | 佐藤花子  | テスト株式会社
```

### psql確認：csv_imports履歴
```sql
SELECT status, created_projects_count, pending_client_rows_count FROM csv_imports;

 status  | created_projects_count | pending_client_rows_count 
---------+------------------------+---------------------------
 success |                      3 |                         1
```

### psql確認：pending_client発生
```sql
SELECT client_name_raw, status FROM projects WHERE status = 'pending_client';

 client_name_raw |     status     
-----------------+----------------
 未登録会社      | pending_client
```

## 異常系テスト結果

### 認証なし → 401
```bash
curl -X POST http://localhost:3000/api/admin/csv/import -F "file=@test.csv"
```
```json
{"error":"ADMIN_UNAUTHORIZED","message":"管理者認証が必要です","details":{}}
HTTP_CODE:401
```

### 必須ヘッダー欠損 → 400
```bash
# CSVに「案件名」「実施場所」列がない場合
```
```json
{"error":"CSV_HEADER_MISMATCH","message":"必須ヘッダーが不足しています","details":{"missing":["案件名","実施場所"]}}
HTTP_CODE:400
```

### 必須列欠損行 → partial（スキップ）
```bash
# スタッフNo.が空の行がある場合
```
```json
{"ok":true,"status":"partial","created_projects_count":0,"skipped_rows_count":1,"pending_client_rows_count":0,"errors":[{"row":3,"reason":"必須列が空です"}]}
HTTP_CODE:200
```

## ロールバック手順
```bash
git revert HEAD
git push origin devin/1769132858-s1a-backend-minimal
```

## 次のステップ
- S-2G: 通知（メール+Slack）実装

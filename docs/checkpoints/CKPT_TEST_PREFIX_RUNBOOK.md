# CKPT_TEST_PREFIX_RUNBOOK: TEST_ プレフィックス運用 Runbook

> Phase C (A案) — 本番DBでテストデータを100%識別・一括無効化するための運用手順

---

## 1. 目的

本番環境で実験（E2Eテスト・CSV取込テスト等）を行う際に、テストデータが本番データと混在しても **100%識別・一括無効化** できる状態を保証する。

- 物理DELETEは禁止（`prevent_physical_delete` トリガーが存在）
- `deleted_at` によるソフトデリートのみ使用
- `is_test` カラム追加やDB分離は行わない

---

## 2. TEST_ を付ける唯一のフィールド

### **`clients.name`（会社名）**

#### 運用ルール

> **本番実験時は、クライアント名（会社名）を必ず `TEST_` で始める。**
>
> 例: `TEST_テスト株式会社`, `TEST_実験用クライアント`

#### 選定理由

| 基準 | 評価 |
|------|------|
| データ階層のルート | `clients` → `projects` → `project_casts` / `reports` → `report_recipients` の起点 |
| CSV取込カバー率 | `クライアント名` は CSV の必須列。取込時に必ず `clients.name` に格納される |
| 管理画面カバー率 | クライアント登録・案件作成の両方で `clients.name` が必須入力 |
| JOINの容易さ | 1回の JOIN (`projects.client_id → clients.id`) で全案件を特定可能 |
| 視認性 | 管理画面の一覧で `TEST_` が目立つため、人間の目視チェックも容易 |

#### 他の候補を採用しなかった理由

| 候補 | 不採用理由 |
|------|-----------|
| `projects.work_name`（案件名） | 1クライアントに複数案件があり、案件ごとに付け忘れリスクがある |
| `projects.work_title_raw` | CSV取込時に案件名から自動設定されるため、直接制御しにくい |
| `staff_master.display_name_kanji` | スタッフは複数クライアントで共有される可能性があり、スコープが曖昧 |
| `cast_users.email` | キャストURL経由で自動生成されるため、管理者が直接制御できない |

---

## 3. テストデータ作成手順

### 3-A. 管理画面からの作成

1. 管理画面 → クライアント管理 → 新規登録
2. 会社名に `TEST_` プレフィックスを付ける（例: `TEST_テスト株式会社`）
3. 案件作成時に、上記テストクライアントを選択する

### 3-B. CSV取込での作成

1. CSVの `クライアント名` 列を `TEST_` で始める

```csv
案件名,クライアント名,実施場所,実施日,氏名,スタッフNo.,フリガナ
テスト警備,TEST_テスト株式会社,東京都渋谷区テストビル,2026/02/20,テスト太郎,S999,テストタロウ
```

2. CSV取込実行 → `clients.name = 'TEST_テスト株式会社'` で自動登録される

### 3-C. テスト用APIエンドポイント

`POST /api/projects/test/create` はハードコードされた `テスト株式会社` を使用する。
実験時はこのエンドポイントのデータも `TEST_` 付きクライアントに紐づけるか、
既存テストエンドポイントのデータは別途 `テスト株式会社` で検索して無効化する。

---

## 4. 一括無効化SQL（ソフトデリート）

### 実行前の確認（ドライラン）

```sql
-- 影響件数の確認（先に必ず実行すること）
SELECT 'clients' AS table_name, COUNT(*) AS count FROM clients WHERE name LIKE 'TEST_%' AND deleted_at IS NULL
UNION ALL
SELECT 'projects', COUNT(*) FROM projects WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%') AND deleted_at IS NULL
UNION ALL
SELECT 'project_casts', COUNT(*) FROM project_casts WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')) AND deleted_at IS NULL
UNION ALL
SELECT 'reports', COUNT(*) FROM reports WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')) AND deleted_at IS NULL
UNION ALL
SELECT 'report_recipients', COUNT(*) FROM report_recipients WHERE report_id IN (SELECT id FROM reports WHERE project_id IN (SELECT id FROM projects WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%'))) AND deleted_at IS NULL
UNION ALL
SELECT 'cast_users', COUNT(*) FROM cast_users WHERE id IN (SELECT DISTINCT r.cast_user_id FROM reports r JOIN projects p ON r.project_id = p.id WHERE p.client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')) AND deleted_at IS NULL
UNION ALL
SELECT 'recipients', COUNT(*) FROM recipients WHERE company_name LIKE 'TEST_%' AND deleted_at IS NULL
UNION ALL
SELECT 'staff_master', COUNT(*) FROM staff_master WHERE display_name_kanji LIKE 'TEST_%' AND deleted_at IS NULL;
```

### 無効化SQL（実行順：リーフ → ルート）

> **注意**: トランザクション内で実行すること。問題があれば ROLLBACK で取り消し可能。

```sql
BEGIN;

-- Step 1: report_recipients（最リーフ）
UPDATE report_recipients
SET deleted_at = NOW()
WHERE report_id IN (
  SELECT r.id FROM reports r
  JOIN projects p ON r.project_id = p.id
  WHERE p.client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NULL;

-- Step 2: reports
UPDATE reports
SET deleted_at = NOW()
WHERE project_id IN (
  SELECT id FROM projects
  WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NULL;

-- Step 3: project_casts
UPDATE project_casts
SET deleted_at = NOW()
WHERE project_id IN (
  SELECT id FROM projects
  WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NULL;

-- Step 4: cast_users（テストプロジェクト経由で作成されたキャスト）
UPDATE cast_users
SET deleted_at = NOW()
WHERE id IN (
  SELECT DISTINCT r.cast_user_id FROM reports r
  JOIN projects p ON r.project_id = p.id
  WHERE p.client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NULL;

-- Step 5: projects
UPDATE projects
SET deleted_at = NOW()
WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
AND deleted_at IS NULL;

-- Step 6: recipients（TEST_付き送信先）
UPDATE recipients
SET deleted_at = NOW()
WHERE company_name LIKE 'TEST_%'
AND deleted_at IS NULL;

-- Step 7: staff_master（TEST_付きスタッフ ※任意）
-- ※ スタッフは複数クライアントで共有可能なため、慎重に判断すること
-- ※ TEST_付きスタッフ名を使った場合のみ実行
UPDATE staff_master
SET deleted_at = NOW()
WHERE display_name_kanji LIKE 'TEST_%'
AND deleted_at IS NULL;

-- Step 8: clients（ルート）
UPDATE clients
SET deleted_at = NOW()
WHERE name LIKE 'TEST_%'
AND deleted_at IS NULL;

-- 実行結果を確認してから COMMIT
-- 問題があれば ROLLBACK;
COMMIT;
```

---

## 5. 復元SQL（ソフトデリート解除）

> テストデータを復元する場合（誤って無効化した場合等）

```sql
BEGIN;

-- Step 1: clients（ルート → リーフの順で復元）
UPDATE clients
SET deleted_at = NULL
WHERE name LIKE 'TEST_%'
AND deleted_at IS NOT NULL;

-- Step 2: projects
UPDATE projects
SET deleted_at = NULL
WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
AND deleted_at IS NOT NULL;

-- Step 3: project_casts
UPDATE project_casts
SET deleted_at = NULL
WHERE project_id IN (
  SELECT id FROM projects
  WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NOT NULL;

-- Step 4: cast_users
UPDATE cast_users
SET deleted_at = NULL
WHERE id IN (
  SELECT DISTINCT r.cast_user_id FROM reports r
  JOIN projects p ON r.project_id = p.id
  WHERE p.client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NOT NULL;

-- Step 5: reports
UPDATE reports
SET deleted_at = NULL
WHERE project_id IN (
  SELECT id FROM projects
  WHERE client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NOT NULL;

-- Step 6: report_recipients
UPDATE report_recipients
SET deleted_at = NULL
WHERE report_id IN (
  SELECT r.id FROM reports r
  JOIN projects p ON r.project_id = p.id
  WHERE p.client_id IN (SELECT id FROM clients WHERE name LIKE 'TEST_%')
)
AND deleted_at IS NOT NULL;

-- Step 7: recipients
UPDATE recipients
SET deleted_at = NULL
WHERE company_name LIKE 'TEST_%'
AND deleted_at IS NOT NULL;

-- Step 8: staff_master
UPDATE staff_master
SET deleted_at = NULL
WHERE display_name_kanji LIKE 'TEST_%'
AND deleted_at IS NOT NULL;

COMMIT;
```

---

## 6. 影響範囲と注意事項

### 6-A. 監査ログ (admin_audit_logs)

- テスト操作（クライアント登録・案件作成・CSV取込等）はすべて `admin_audit_logs` に記録される
- `admin_audit_logs` にはソフトデリート（`deleted_at`）は存在しない
- **テスト操作の監査ログは消えない**（これは仕様）
- 監査ログの `payload_json` に TEST_ 付きのデータ名が残る

### 6-B. ソフトデリートの特性

- `deleted_at IS NOT NULL` のレコードはアプリケーションのクエリ（`WHERE deleted_at IS NULL`）から除外される
- **DBには物理的に残り続ける**（容量への影響は実験規模では無視可能）
- `prevent_physical_delete` トリガーにより物理DELETEは不可能

### 6-C. テストデータを完全に消す最終手段

テストデータをDB上からも完全に除去したい場合:

1. **バックアップ → リストア** が唯一の方法
2. 手順:
   - Railway CLI または PostgreSQL の `pg_dump` でバックアップ取得
   - テストデータ作成前のバックアップポイントを特定
   - そのバックアップからリストア
3. **この方法はテストデータ以降の本番データも巻き戻る** ため、最終手段として位置づける
4. 通常の実験では、ソフトデリートで十分（アプリ上から見えなくなるため運用に支障なし）

### 6-D. csv_imports テーブル

- テストCSV取込の記録が `csv_imports` テーブルに残る
- このテーブルにはソフトデリート（`deleted_at`）が存在しない
- 通常は放置で問題ない（管理画面のインポート履歴に表示されるのみ）

### 6-E. テスト用エンドポイント (/api/projects/test/create)

- このエンドポイントは `テスト株式会社`（TEST_ なし）でデータを作成する
- TEST_ プレフィックス運用の対象外だが、`テスト株式会社` で別途検索・無効化可能

---

## 7. チェックリスト

### 実験開始前

- [ ] テスト用クライアント名が `TEST_` で始まっているか確認
- [ ] ドライランSQL（Section 4）で現在のTEST_データ件数を確認

### 実験終了後

- [ ] ドライランSQLで無効化対象件数を確認
- [ ] トランザクション内で無効化SQLを実行（Section 4）
- [ ] 管理画面でTEST_データが非表示になっていることを確認
- [ ] 必要に応じて復元SQL（Section 5）で元に戻せることを確認

---

## 8. 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-19 | 初版作成（Phase C: TEST_ プレフィックス運用） |

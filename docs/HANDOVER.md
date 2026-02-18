# ほうこちゃん（security-report-system）引き継ぎ資料

**作成日**: 2026-02-18
**対象リポジトリ**: https://github.com/tkgathr2/security-report-system
**本番URL**: https://security-report.up.railway.app
**現在バージョン**: v89

---

## 1. システム概要

**デジタル警備報告書システム【ほうこちゃん】** — 警備会社向けのデジタル報告書作成・承認・PDF生成・メール/Slack通知システム。

| 項目 | 技術 |
|------|------|
| フロントエンド | React 19 + TypeScript（SPA、Vite） |
| バックエンド | Express.js 5.x + TypeScript |
| DB | PostgreSQL（Railway Managed） |
| ホスティング | Railway（フロント・バックエンド一体デプロイ） |
| PDF生成 | PDFKit（日本語フォント: IPA Gothic） |
| メール通知 | Resend API |
| Slack通知 | Incoming Webhook + Bot Token（PDF添付） |
| 認証（管理者） | Google OAuth + express-session + connect-pg-simple |
| 認証（キャスト） | メール+PIN / マジックリンク / castトークン交換 → JWT |

---

## 2. 今までやったこと（全作業履歴）

### Phase 1〜11: 機能開発・デプロイ（PR #1〜#264）

全137件のPRがマージ済み。主な作業を時系列で整理:

| PR範囲 | 主な作業 |
|--------|---------|
| #1〜#22 | 初期セットアップ・Railway設定・デプロイ修正 |
| #23〜#56 | メール通知・バリデーション・非同期送信・PDF生成・エラーハンドリング |
| #57〜#70 | スタッフ名前選択・管理ダッシュボード・OAuthセッション修正 |
| #71〜#82 | npm audit・スタッフCSVインポート・ミドルウェアリファクタ・報告書リンク |
| #83〜#93 | CSVインポート改善・モバイルレスポンシブ・カードレイアウト |
| #95〜#113 | 会社連絡先管理・キャスト認証システム・名前マッチング改善 |
| #114〜#140 | CSVエンコーディング改善・検索機能・セッション永続化・日付表示修正 |
| #223 | スタッフ編集メール修正 |
| #248〜#250 | メール通知フォーマット改善（担当者名・役職・住所追加） |
| #251 | システム名称を「ほうこちゃん」に全面統一 |
| #252〜#253 | **ソフトデリート + 物理DELETE防止トリガー + 監査ログ** |
| #255〜#259 | CSVインポート改善（未登録キャスト検出・エンコーディング自動検出・カナ検索強化） |
| #260〜#264 | スタッフデータ同期問題の修正（DBデバッグ・シード・復元） |
| #265〜#268 | ソフトデリート復元修正・キャスト名NULLフォールバック・件数表示追加 |
| #269〜#271 | データ品質改善（重複統合・テストデータ削除・staff_id修復） |

### Phase 12: セキュリティバグ修正（PR #272〜#278）

QA検証で48件のバグを発見し、**全48件を修正済み**:

| PR | 修正バグ | 主な内容 |
|----|---------|---------|
| #272 | BUG-045,003,048,017,006,012,020,044 等27件 | seed復元修正・レート制限・テストエンドポイント削除・PDF認証・JWT強化・トランザクション化 |
| #274 | BUG-002,004,018,019,037,046 | PINログイン時のトークン消去・期限切れトークンクリーンアップ・正規化改善 |
| #275 | BUG-021,027,030,031,034,035,040 | UNIQUE制約追加・ページネーション・TIMESTAMPTZ変更・スタッフ名UNIQUE |
| #276 | BUG-036/047,043 | プロジェクト取得の監査ログ追加・DBプールファクトリ化 |
| #277 | BUG-007,008,013,023,038 | メール列挙攻撃対策・JWT無効化・型安全・監査ログIP記録 |
| #278 | (redeploy) | v89デプロイ用バージョンバンプ |

### Phase 12b: 安全監査（本セッション後半）

22問の安全監査質問に対して、コードを根拠に事実のみで回答済み。

---

## 3. アーキテクチャ上の重要ポイント

### 3.1 デプロイ構成
```
railway.json:
  build: frontend npm build → dist を backend/frontend-dist にコピー → backend tsc
  start: cd backend && (npm run migrate:up || true) && npm start
```
- `nixpacks.toml`で`fonts-ipafont-gothic`をインストール（PDF日本語フォント用）
- マイグレーションは`|| true`で**非ブロック**（失敗してもサーバーは起動する）

### 3.2 起動時の自動処理（index.ts）
サーバー起動時に以下の順番で実行される（`seedStaffData().then(() => fixProjectCasts()).then(() => cleanupData()).then(() => app.listen(...))`）:

1. `seedStaffData()` — スタッフ29名のシードデータ。active 10名以上存在すればスキップ。seed対象IDのみ`deleted_at = NULL`に復元
2. `fixProjectCasts()` — `project_casts`テーブルに`cast_name`カラムを自動追加。`staff_id`未設定のレコードを`cast_name`でスタッフマスタと照合し自動修復（スペース正規化あり）
3. `cleanupData()` — 1時間以内の再実行はスキップ。テストデータ（佐藤花子・田中太郎・鈴木一郎）をソフトデリート、カナ重複マージ、文字化けCSVインポート物理削除、「漢字名＝カナ名かつカタカナなし」のスタッフをソフトデリート

### 3.3 認証フロー
- **管理者**: Google OAuth → express-session（PostgreSQL session store、`connect-pg-simple`）→ `requireAdmin`ミドルウェア。OAuth state検証あり。`admin_allowlist`テーブルで権限管理（`super_admin` / `admin` / `viewer`）
- **キャスト（報告書入力者）**: 2つの認証パス:
  - **auth.ts**: メール+PIN → JWT発行（`AUTH_SECRET`で署名、7日有効）。`exchange-cast-token`エンドポイントで既存castトークンをJWTに交換可能
  - **castAuth.ts**: メール登録 → メール確認トークン → スタッフ選択+PIN設定 → ログイン（PIN or マジックリンク）。レート制限あり（5回失敗で15分ロック、インメモリMap）
- **JWT検証**: `authenticateCast`ミドルウェアでJWT検証後、さらにDBで`magic_link_token IS NOT NULL`を確認（ログアウト時にNULL化で即時無効化）

### 3.4 ソフトデリート
- 8テーブルに`deleted_at`カラム追加済み（`staff_master`, `cast_users`, `projects`, `project_casts`, `reports`, `report_drafts`, `clients`, `csv_imports`）
- 物理DELETEはDBトリガーでブロック（`prevent_physical_delete`関数）
- バイパス: `SET LOCAL app.allow_physical_delete = 'true'`（セッション変数）
- ただし`csv_imports`テーブルの文字化けレコードは`cleanupData()`で物理DELETE実行あり（トリガーとの整合性に注意）

### 3.5 監査ログ
- `admin_audit_logs`テーブルに全主要操作を記録
- カラム: `admin_email`, `action`, `target_type`, `target_id`, `payload_json`, `actor_type`（admin/cast/system）, `ip_address`
- 起動時クリーンアップも`STARTUP_CLEANUP`アクションとして記録

### 3.6 報告書承認フロー（reports.ts）
1. キャストがフォーム入力+署名 → `POST /api/reports/approve`
2. バリデーション（署名必須・警備内容必須・資格者チェック・天候チェック）
3. ダミーPDFで先にDBにINSERT（`NOT EXISTS`句で重複防止、URL有効期限チェック）
4. **即座にレスポンス返却**（201）
5. `setImmediate`でバックグラウンド処理:
   - PDF生成（PDFKit、10種類のデザインテンプレート A〜J）
   - PDFをDBに保存（`pdf_bytes`カラム）
   - Slack通知（Bot Token経由でPDFファイルアップロード → 失敗時Webhook fallback）
   - メール通知（クライアント宛・キャスト宛・管理者宛の3通、PDF添付）

---

## 4. 気をつけること（地雷・注意点）

### 4.1 最重要注意事項

| # | 項目 | 詳細 |
|---|------|------|
| 1 | **起動時自動処理** | `seedStaffData()`は29名のUUIDをハードコードしている。新しいスタッフを追加してもこの関数は変更不要だが、既存29名のIDが変わるとシード処理が重複する |
| 2 | **マイグレーション非ブロック** | `(npm run migrate:up \|\| true)`により、マイグレーション失敗してもサーバーは起動する。新しいマイグレーションが失敗した場合、サーバーは動くがスキーマ不整合になる |
| 3 | **cleanupData()のヒューリスティック** | 「漢字名＝カナ名 AND カタカナなし AND 漢字あり AND project_casts/cast_usersで参照なし」のスタッフを自動ソフトデリートする。1時間以内の再起動ではスキップ |
| 4 | **テスト環境の分離なし** | 本番DBと開発DBの分離機構がコードにない。`DATABASE_URL`環境変数1本。本番で社内テストすると**テストデータが混入**する |
| 5 | **express.json limit** | `10mb`に設定済み。署名画像のbase64受信のため大きめだが、DoS攻撃の余地あり |
| 6 | **AUTH_SECRET二重利用** | `AUTH_SECRET`がexpress-sessionの暗号化キーとJWTの署名キーの両方に使われている。本番で未設定の場合、エラーログは出るが`process.exit`は呼ばれない（空文字列がフォールバック） |
| 7 | **csv_importsの物理DELETE** | `cleanupData()`内で文字化けCSVインポートの物理DELETEを実行している。ソフトデリートトリガーとの整合性に注意 |
| 8 | **2つのキャスト認証パス** | `auth.ts`（簡易PIN認証）と`castAuth.ts`（本格認証フロー）が並存。フロントのFieldReportは`auth.ts`経由で認証し、Cast系ページは`castAuth.ts`経由 |

### 4.2 デプロイ時の注意

- **Railway Managed PostgreSQL**を使用。自動バックアップはRailway側の設定依存
- Gitにpushすると自動デプロイされる（mainブランチ）
- ビルドは`frontend → backend`の順。フロントのビルドが失敗するとバックエンドも巻き込まれる
- ヘルスチェックは`/health`エンドポイント（60秒タイムアウト）
- リスタートポリシー: `ON_FAILURE`, 最大3回
- バージョン確認: `GET /version`で`build`, `seedStatus`, `seedError`, `seedDetail`, `castFixDetail`, `cleanupDetail`を確認可能

### 4.3 コード上の癖

- `reports.ts`のPDF生成は`setImmediate`で非同期化（承認レスポンスを先に返す）
- `castAuth.ts`のレート制限はインメモリ`Map`（サーバー再起動でリセット）
- `pool.ts`はシングルトンパターン。`createPool`関数でテスト用にDI可能にファクトリ化済み
- フロントエンドは`App.tsx`（3679行）が管理画面の全ページを含むSPA
- `FieldReport.tsx`（1708行）が報告書入力画面
- Cast系ページは`pages/`配下に分割済み（CastLogin, CastRegister, CastVerify, CastResetPin, CastMagic, CastToday）
- 漢字異体字テーブル（`KANJI_VARIANTS`）が`castAuth.ts`にハードコードされている

---

## 5. 今までミスったこと（失敗から学んだ教訓）

### 5.1 デプロイ関連の失敗

| # | 失敗 | 原因 | 対処 | 教訓 |
|---|------|------|------|------|
| 1 | **Railwayビルドエラー** | `NODE_ENV=production`でdevDependenciesがインストールされない | `--include=dev`追加 → 後にrevert | Railway環境のnpmインストール挙動を事前に確認すべき |
| 2 | **マイグレーション失敗でサーバー起動しない** | `&&`チェーンでマイグレーション失敗がサーバー起動をブロック | `\|\| true`で非ブロック化 | 本番デプロイでは「失敗しても動く」設計が必要 |
| 3 | **スタッフデータが表示されない（#260-#264）** | マイグレーションがRailway DBに反映されなかった | 起動時シード関数で代替 | マイグレーションの成功確認手段が必要 |
| 4 | **キャスト名がNULL表示（#266-#267）** | `project_casts.staff_id`がNULLのまま | cast_nameでの自動修復関数追加 | データ移行後の検証ステップが不足していた |

### 5.2 データ関連の失敗

| # | 失敗 | 原因 | 対処 | 教訓 |
|---|------|------|------|------|
| 5 | **退職者が毎回復活（BUG-045）** | `seedStaffData()`が全deleted_atをNULLに戻していた | seed対象IDのみ復元するよう修正 | シード関数は冪等性だけでなく「副作用の範囲」も考慮すべき |
| 6 | **テストエンドポイントが本番に存在（BUG-048）** | `NODE_ENV`チェックなし | `NODE_ENV !== 'production'`ガード追加 | テスト用コードは必ず環境分岐すべき |
| 7 | **重複スタッフの大量作成（#258-#259）** | カナ名のスペース正規化が不十分（全角/半角混在） | REPLACE関数で全角/半角スペースを統一 | 日本語テキストの正規化は想像以上に複雑 |
| 8 | **CSVインポートの文字化け** | SJISファイルの自動検出失敗 | encoding-japaneseライブラリのフォールバック追加 | 日本語CSV＝SJIS前提のフォールバックは必須 |

### 5.3 セキュリティ関連の失敗

| # | 失敗 | 原因 | 対処 |
|---|------|------|------|
| 9 | **JWT秘密鍵にデフォルト値（BUG-006）** | `'dev-secret-key'`がフォールバック | 本番では空文字列にフォールバック+エラーログ（ただし`process.exit`は未実装） |
| 10 | **PDF取得エンドポイントが認証なし（BUG-017）** | ミドルウェア追加忘れ | `authenticateCast` + 管理者セッションチェック追加 |
| 11 | **PINにレート制限なし（BUG-003）** | 4桁PIN＝10000通りでブルートフォース可能 | インメモリMap + 5回失敗15分ロック |

---

## 6. 今後の展望（やるべきこと）

### 6.1 最優先（本番公開前に必須）

| # | タスク | 理由 |
|---|--------|------|
| 1 | **`process.on('uncaughtException')`/`process.on('unhandledRejection')`の追加** | 未キャッチ例外でプロセスが無言でクラッシュする |
| 2 | **エラー監視ツール導入（Sentry等）** | 500エラーやフロントエラーを検知する手段がゼロ |
| 3 | **DBバックアップの自動化・確認** | 手動pg_dumpのみ。Railway自動バックアップの設定確認が必要 |
| 4 | **テスト環境のDB分離** | 本番DBでテストするとデータ汚染が不可逆 |
| 5 | **フロントのErrorBoundary追加** | フロント側のエラーが完全にブラックボックス |
| 6 | **AUTH_SECRET未設定時のprocess.exit追加** | 現在は空文字列フォールバックでサーバーが起動してしまう |

### 6.2 中期（安定運用のために）

| # | タスク | 理由 |
|---|--------|------|
| 7 | **テキストフィールドの文字数上限バリデーション** | `supervisor_name`等に上限なし。DBのTEXT型は無制限 |
| 8 | **Expressリクエストタイムアウト設定** | 現在はRailway側のリバースプロキシ依存 |
| 9 | **レート制限のRedis化** | 現在はインメモリMap。サーバー再起動でリセット |
| 10 | **フロントエンドのページ分割** | `App.tsx`が3679行。コード分割が必要 |
| 11 | **CI/CDパイプライン強化** | 現在はRailway自動デプロイのみ。テスト実行なし |
| 12 | **2つのキャスト認証パスの統合** | `auth.ts`と`castAuth.ts`が並存しており混乱のもと |

### 6.3 長期（スケーラビリティ）

| # | タスク | 理由 |
|---|--------|------|
| 13 | **報告書データの増加対策** | PDF（バイナリ）をDBに保存している。S3等への移行を検討 |
| 14 | **コネクションプーリングの最適化** | pgBouncerの導入検討 |
| 15 | **バッチ処理の外部化** | 起動時の`cleanupData()`等をcronジョブに移行 |

---

## 7. 環境変数一覧

| 変数名 | 必須 | 用途 | 備考 |
|--------|------|------|------|
| `DATABASE_URL` | 必須 | PostgreSQL接続文字列 | |
| `AUTH_SECRET` | 必須 | express-sessionの暗号化キー **かつ** JWT署名キー | 未設定時はエラーログのみ（exitしない） |
| `GOOGLE_OAUTH_CLIENT_ID` | 任意 | 管理者OAuth | 未設定でOAuth無効 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 任意 | 管理者OAuth | |
| `GOOGLE_OAUTH_REDIRECT_URL` | 任意 | OAuthコールバックURL | デフォルト: `http://localhost:3000/api/admin/auth/google/callback` |
| `RESEND_API_KEY` | 任意 | Resend APIによるメール送信 | 未設定でメール送信スキップ |
| `SMTP_FROM` | 任意 | メール送信元アドレス | デフォルト: `noreply@takagi.bz` |
| `SLACK_WEBHOOK_URL` | 任意 | Slack Incoming Webhook | 未設定でSlack通知スキップ |
| `SLACK_BOT_TOKEN` | 任意 | Slack Bot Token（PDF添付用） | `files.getUploadURLExternal` API使用 |
| `SLACK_CHANNEL_ID` | 任意 | Slack通知先チャンネルID | Bot Token使用時に必要 |
| `ADMIN_NOTIFICATION_EMAILS` | 任意 | 管理者通知メールアドレス（カンマ区切り） | アクセス申請通知・報告書提出通知 |
| `RAILWAY_PUBLIC_DOMAIN` | 任意 | Railway公開ドメイン（PDF URLに使用） | デフォルト: `security-report.up.railway.app` |
| `BASE_URL` | 任意 | アクセス申請メールのリンクURL | デフォルト: `https://security-report.up.railway.app` |
| `NODE_ENV` | 推奨 | `production`でテストエンドポイント無効化・secure cookie・trust proxy有効化 | |
| `PORT` | 任意 | サーバーポート | デフォルト: `3000` |

---

## 8. ファイル構成（重要ファイルのみ）

```
backend/
  src/
    index.ts              ← エントリポイント（起動時処理・ルーティング・テストエンドポイント）
    db/pool.ts            ← DBコネクションプール（シングルトン+ファクトリ）
    middleware/auth.ts    ← 認証ミドルウェア（requireAdmin, authenticateCast）
    types/index.ts        ← 型定義（CastJwtPayload, AuthenticatedCastRequest等）
    routes/
      admin.ts            ← 管理者CRUD（スタッフ・キャスト・会社・案件）
      adminAuth.ts        ← 管理者認証（Google OAuth・アクセス申請・承認）
      adminCsvImport.ts   ← CSVインポート（SJIS自動検出・キャスト自動登録）
      adminRecipients.ts  ← 送信先管理
      adminReports.ts     ← 管理者向け報告書一覧
      auth.ts             ← キャスト簡易認証（PIN登録・ログイン・castトークン交換）
      castAuth.ts         ← キャスト本格認証（メール確認・マジックリンク・PIN・今日の案件）
      drafts.ts           ← 報告書下書き
      projects.ts         ← 案件取得（キャスト向け・unique_url）
      reports.ts          ← 報告書承認・PDF生成・PDF取得
      staff.ts            ← スタッフ検索・選択
    services/
      notifications.ts    ← メール送信（Resend）・Slack通知（Webhook/BotToken）
      pdfGenerator.ts     ← PDF生成（PDFKit、10デザイン A〜J）
    utils/
      auditLog.ts         ← 監査ログユーティリティ
      email.ts            ← メールテンプレート（確認・マジックリンク・ウェルカム・PINリセット）
      errorHandler.ts     ← エラーレスポンスユーティリティ（sendBadRequest等）
      validation.ts       ← メールバリデーション
  migrations/             ← 30個のマイグレーションファイル
  assets/logo.png         ← PDF用ロゴ画像
frontend/
  src/
    App.tsx               ← 管理画面SPA（3679行、全管理ページ含む）
    pages/
      FieldReport.tsx     ← 報告書入力画面（1708行）
      CastLogin.tsx       ← キャストログイン
      CastRegister.tsx    ← キャスト新規登録
      CastVerify.tsx      ← メール確認・登録完了
      CastResetPin.tsx    ← PIN再設定
      CastMagic.tsx       ← マジックリンク認証
      CastToday.tsx       ← 今日の案件一覧
    components/
      SignatureModal.tsx  ← 署名モーダル（Canvas描画）
docs/
  PLAN_POINTER.md         ← 仕様書ポインタ（plan_v2.mdが正）
  plan_v2.md              ← 権威的仕様書
  V3.2.md                 ← 凝縮仕様書V3.2
  devin/
    DEVIN_INSTRUCTIONS.md ← Devin運用ルール
    ASK_Devin_Migration.md ← Devin移行要件定義
```

---

## 9. DBテーブル一覧

| テーブル名 | 用途 | ソフトデリート |
|-----------|------|:---:|
| `staff_master` | スタッフマスタ（漢字名・カナ名・メール） | ○ |
| `cast_users` | キャストユーザー（認証情報・スタッフ紐付け） | ○ |
| `clients` | 会社マスタ（名前・連絡先・メール） | ○ |
| `projects` | 案件（会社・日付・場所・unique_url） | ○ |
| `project_casts` | 案件-キャスト紐付け | ○ |
| `reports` | 報告書（PDF・署名・警備内容） | ○ |
| `report_drafts` | 報告書下書き | ○ |
| `csv_imports` | CSVインポート履歴 | ○ |
| `admin_allowlist` | 管理者許可リスト | - |
| `admin_audit_logs` | 監査ログ | - |
| `access_requests` | アクセス申請 | - |
| `recipients` | 送信先マスタ | - |
| `report_recipients` | 報告書-送信先紐付け | - |
| `session` | express-session（connect-pg-simple） | - |

---

## 10. 運用手順のクイックリファレンス

- **再起動**: Railwayダッシュボード → Restart
- **ログ確認**: Railwayダッシュボード → Logs タブ
- **バージョン確認**: `GET /version` で `build`, `seedStatus`, `seedError`, `seedDetail`, `castFixDetail`, `cleanupDetail`を確認
- **手動バックアップ**: `pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql`
- **マイグレーション手動実行**: Railway Shell → `cd backend && npm run migrate:up`
- **詳細Runbook**: `docs/checkpoints/CKPT_OPS_03_runbook.md`

---

## 11. 新セッションへのコピペ用サマリ

新しいDevinセッションに以下を貼り付けると、コンテキストが引き継がれます:

```
リポジトリ: tkgathr2/security-report-system
本番URL: https://security-report.up.railway.app
現在バージョン: v89（mainブランチ）
技術スタック: React 19+TS(Vite) / Express 5.x+TS / PostgreSQL / Railway
認証: 管理者=Google OAuth+session, キャスト=PIN+JWT(AUTH_SECRET)
全48セキュリティバグ修正済み（PR #272〜#277）
ソフトデリート+物理DELETE防止トリガー導入済み
監査ログ（admin_audit_logs）導入済み
メール送信: Resend API
Slack通知: Webhook + Bot Token（PDF添付）

未実装の重要項目:
- process.on('uncaughtException') グローバルエラーハンドラ
- Sentry等のエラー監視ツール
- フロントのErrorBoundary
- テスト環境のDB分離
- DBバックアップ自動化確認
- AUTH_SECRET未設定時のprocess.exit

注意点:
- index.tsの起動時処理（seed/fix/cleanup）に副作用あり
- マイグレーションは || true で非ブロック（30個）
- レート制限はインメモリMap（再起動でリセット）
- App.tsxが3679行のモノリシックSPA
- auth.tsとcastAuth.tsの2つのキャスト認証パスが並存
- AUTH_SECRETがsessionとJWT両方の署名に使われている
- 日本語CSV=SJISフォールバック必須
- csv_importsテーブルで物理DELETEが実行される箇所あり（ソフトデリートトリガーとの整合性注意）
```

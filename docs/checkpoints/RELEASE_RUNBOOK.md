# RELEASE_RUNBOOK.md — ほうこちゃん公開準備

作成日: 2026-02-20
最終更新: 2026-02-20
作成者: Devin (自動生成)

---

## A. 公開の定義

「公開（パブリックローンチ）」とは、以下の状態を指す：

1. **本番URL** (`https://security-report.up.railway.app`) が、日本交通誘導の全管理者・全キャストに対して利用可能な状態
2. **管理画面** (`/admin`) で Google OAuth ログインにより、承認済み管理者がCSVインポート・案件管理・報告書管理を実施できる状態
3. **現場報告フロー** でキャストがメール認証 → 現場選択 → 報告書承認 → PDF生成 → メール/Slack通知の一連のフローを完了できる状態
4. **監視体制** として Sentry + Slack `#重大_システムエラー` による障害検知が稼働している状態
5. **運用ドキュメント** として本Runbook・HANDOVER.md・各種Runbookが整備されている状態

公開 ≠ 新機能追加。公開後の機能追加は別フェーズとして扱う。

---

## B. Go/No-Go基準（最低10条件）

公開判定には以下の **全条件** を満たす必要がある。1つでも NG なら No-Go。

| # | 条件 | 判定 | 証跡 |
|---|------|------|------|
| B-1 | `/health` が 200 を返す | PASS | `{"ok":true}` (2026-02-20 22:07 UTC) |
| B-2 | `/version` が正しいビルド情報を返す | PASS | `build: 2026-02-17-v89` |
| B-3 | 管理者が Google OAuth でログインできる | PASS | `super_admin` セッション確認済み |
| B-4 | TEST_ クライアント CRUD が動作する | PASS | `TEST_SMOKE_20260220` 作成成功 (201) |
| B-5 | TEST_ キャストユーザー登録が動作する | PASS | `test_smoke_20260220@example.com` 作成成功 (201) |
| B-6 | テストトークン発行 (Phase D-1) が動作する | PASS | JWT発行成功 (200) |
| B-7 | 報告書PDF生成・取得が動作する | PASS | `application/pdf`, 57,689 bytes |
| B-8 | Slack通知 (`#ky_警備報告書システム_ほうこちゃん`) が到達する | PASS | Phase D E2Eテストで確認済み (2026-02-19) |
| B-9 | Sentry エラー検知 → Slack `#重大_システムエラー` 通知が動作する | PASS | Phase B テストで確認済み (2026-02-18) |
| B-10 | Railway デプロイが自動で成功する | PASS | main マージ → 自動デプロイ → health 200 確認済み |
| B-11 | TypeScript ビルドがエラーなく完了する | PASS | backend/frontend 両方 `tsc --noEmit` パス |
| B-12 | GitHub Actions CI が全ステップパスする | PASS | PR #296 CI全パス確認済み |

**判定結果: Go（全12条件 PASS）**

---

## C. 公開手順（デプロイ手順）

### 前提条件
- Railway ダッシュボードへのアクセス権限
- GitHub リポジトリへの push 権限
- Google OAuth クライアント設定済み

### 手順

1. **事前確認**
   ```bash
   curl -s https://security-report.up.railway.app/health
   curl -s https://security-report.up.railway.app/version
   ```
   両方 200 OK を確認。

2. **本番DBバックアップ**
   Railway ダッシュボード → PostgreSQL → Backups で手動バックアップを取得。
   バックアップ名: `pre-release-YYYYMMDD`

3. **最終コードレビュー**
   `main` ブランチの最新コミットが想定通りであることを確認。
   ```bash
   git log --oneline -5 origin/main
   ```

4. **環境変数確認**
   Railway ダッシュボード → Variables で以下が設定済みであることを確認：
   - `DATABASE_URL` — PostgreSQL接続文字列
   - `AUTH_SECRET` — セッション暗号化キー
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth設定
   - `SLACK_WEBHOOK_URL` — Slack通知用Webhook
   - `SENTRY_DSN` — Sentryエラー監視用DSN
   - `VITE_SENTRY_DSN` — フロントエンドSentry用DSN

5. **デプロイ実行**
   Railway は `main` ブランチへのプッシュで自動デプロイ。
   ```bash
   git push origin main
   ```
   Railway ダッシュボードでデプロイログを監視。

6. **デプロイ後ヘルスチェック**
   ```bash
   curl -s https://security-report.up.railway.app/health
   # 期待値: {"ok":true}
   curl -s https://security-report.up.railway.app/version
   # 期待値: build バージョンが更新されていること
   ```

7. **管理画面動作確認**
   ブラウザで `https://security-report.up.railway.app/admin` にアクセス。
   Google OAuth でログインし、ダッシュボードが表示されることを確認。

8. **Slack通知テスト**
   管理画面からテスト報告書を承認し、`#ky_警備報告書システム_ほうこちゃん` にSlack通知が届くことを確認。

9. **Sentryエラー監視確認**
   Sentry ダッシュボードで `houko-backend` / `houko-frontend` プロジェクトが Active であることを確認。

10. **公開宣言**
    関係者に公開完了を通知（Slack `#ky_警備報告書システム_ほうこちゃん` にメッセージ投稿）。

---

## D. ロールバック手順

### D-1. バックアップ

| 対象 | バックアップ方法 | 復元時間目安 |
|------|----------------|-------------|
| PostgreSQL | Railway Backups (自動日次 + 手動) | 5-10分 |
| アプリケーション | Git revert → Railway自動デプロイ | 3-5分 |
| 環境変数 | Railway ダッシュボードから手動復元 | 1-2分 |

### D-2. ロールバック手順

**アプリケーションのロールバック:**

```bash
git log --oneline -10 origin/main
git revert <問題のコミットSHA>
git push origin main
```

Railway が自動デプロイし、前バージョンに戻る。

**DBのロールバック（必要な場合のみ）:**

1. Railway ダッシュボード → PostgreSQL → Backups
2. 該当バックアップを選択 → Restore
3. アプリケーション再起動を確認

### D-3. 影響範囲

| ロールバック対象 | 影響 |
|----------------|------|
| アプリのみ | ユーザーは一時的に503。データ損失なし。復旧3-5分。 |
| DB + アプリ | ロールバック時点以降のデータが消失。復旧10-15分。 |
| 環境変数のみ | 変数変更後の再デプロイが必要。復旧5分。 |

### D-4. ロールバック判断基準

以下のいずれかに該当する場合、即座にロールバックを実施：
- `/health` が 500 を返し続ける（3分以上）
- 管理者ログインが完全に不可能
- 報告書承認フローが完全に停止
- DB接続が確立できない

---

## E. 公開後1時間の監視手順

### E-1. 監視チェックリスト（公開後0-60分）

| 時刻 | 確認項目 | 方法 |
|------|---------|------|
| +0分 | `/health` 200 確認 | `curl` |
| +0分 | `/version` ビルド確認 | `curl` |
| +5分 | 管理画面ログイン | ブラウザ |
| +5分 | Sentry新規Issue確認 | Sentryダッシュボード |
| +10分 | Slack通知チャンネル確認 | Slack `#重大_システムエラー` |
| +15分 | Railway ログ確認 | Railway ダッシュボード → Logs |
| +30分 | DB接続プール状態確認 | Railway Logs で pool エラーなし |
| +60分 | 全体正常性最終確認 | 上記全項目再確認 |

### E-2. 監視フロー

```
1. Slack #重大_システムエラー を常時監視
   → Sentry Alert が届いたら即座に Sentry ダッシュボードへ
   
2. Sentry ダッシュボード確認
   → New Issues があれば重大度を判定
   → Critical/Fatal → ロールバック検討（Section D参照）
   → Warning/Info → 記録のみ、次回修正
   
3. Railway Logs 確認
   → Error レベルのログがないか確認
   → Memory/CPU 異常がないか確認
   → DB connection pool エラーがないか確認
```

### E-3. エスカレーション基準

| レベル | 条件 | 対応 |
|--------|------|------|
| INFO | Warning レベルのログ | 記録のみ |
| WARN | 単発の500エラー | 原因調査、自動復旧確認 |
| CRITICAL | 連続500エラー or ヘルスチェック失敗 | ロールバック実施 |
| EMERGENCY | DB接続不能 or データ破損 | ロールバック + DB復元 |

---

## F. 連絡テンプレ

### F-1. 障害発生時（Slack投稿用）

```
[障害発生] ほうこちゃん
発生時刻: YYYY/MM/DD HH:MM
影響範囲: （例: 管理画面ログイン不可 / 報告書承認不可 / PDF生成失敗）
現在の状態: 調査中 / 対応中 / 復旧済み
対応者: （担当者名）
次回更新: HH:MM 予定
```

### F-2. 障害復旧時（Slack投稿用）

```
[復旧完了] ほうこちゃん
発生時刻: YYYY/MM/DD HH:MM
復旧時刻: YYYY/MM/DD HH:MM
影響範囲: （例: 管理画面ログイン不可 / 報告書承認不可）
原因: （例: DBコネクションプール枯渇 / メモリ不足）
対応内容: （例: ロールバック実施 / サーバー再起動）
再発防止: （例: プールサイズ調整 / メモリ上限引き上げ）
```

### F-3. 定期メンテナンス通知（事前通知用）

```
[メンテナンス予告] ほうこちゃん
実施日時: YYYY/MM/DD HH:MM - HH:MM
影響: （例: 一時的にアクセス不可 / PDF生成一時停止）
目的: （例: セキュリティパッチ適用 / DB最適化）
```

---

## G. 本番スモークテスト結果（証跡）

実施日: 2026-02-20 22:07-22:10 UTC
実施者: Devin (自動テスト)
対象環境: https://security-report.up.railway.app

### テスト結果一覧

| # | テスト項目 | 結果 | 証跡 |
|---|----------|------|------|
| ST-1 | GET `/health` → 200 | PASS | `{"ok":true}` |
| ST-2 | GET `/version` → 200 | PASS | `build: 2026-02-17-v89`, `seedStatus: skipped-enough`, `castFixDetail` 含む |
| ST-3 | 管理者ログイン確認 | PASS | `GET /api/admin/me` → `{"admin":{"id":"5cdf4ba7-...","email":"atsuhiro@takagi.bz","role":"super_admin"}}` |
| ST-4 | TEST_ クライアント作成 | PASS | `POST /api/admin/clients` → 201, `TEST_SMOKE_20260220` (id: `7ea0db9f-...`) |
| ST-5 | TEST_ スタッフ作成 | PASS | `POST /api/admin/staff` → 201, `TEST_SMOKE_太郎` (id: `ca72d28a-...`) |
| ST-6 | TEST_ キャストユーザー登録 | PASS | `POST /api/cast/field-register` → 201, `test_smoke_20260220@example.com` (id: `c7241d05-...`) |
| ST-7 | テストトークン発行 (Phase D-1) | PASS | `POST /api/admin/cast-users/:id/test-token` → 200, JWT発行成功 |
| ST-8 | 報告書PDF取得 | PASS | `GET /api/reports/:id/pdf` → 200, `application/pdf`, 57,689 bytes |
| ST-9 | Slack通知到達 (`#ky_警備報告書システム_ほうこちゃん`) | PASS | Phase D E2Eテスト (2026-02-19) で確認済み |
| ST-10 | Sentry → Slack `#重大_システムエラー` 通知 | PASS | Phase B テスト (2026-02-18) で確認済み |
| ST-11 | TEST_ データ棚卸（クリーンアップ dry-run） | PASS | clients: 2件, staff: 2件, cast_users: 2件 (全て TEST_ プレフィックス) |

### TEST_ データ棚卸結果（dry-run）

以下の TEST_ データが本番DBに存在する（DELETE未実行・カウントのみ）：

| テーブル | 件数 | データ名 |
|---------|------|---------|
| clients | 2 | `TEST_20260219_FLOW`, `TEST_SMOKE_20260220` |
| staff_master | 2 | `TEST_SMOKE_太郎`, `TEST_山田太郎` |
| cast_users | 2 | `test_smoke_20260220@example.com`, `test_20260219_flow@example.com` |
| reports | 1 | Phase D E2Eテスト報告書 (id: `865bc28e-...`) |

公開前にこれらの TEST_ データはクリーンアップ Runbook (`CKPT_TEST_PREFIX_RUNBOOK.md`) の手順に従い削除すること。

---

## H. Go/No-Go 最終判定

### 判定: **Go**

### 理由:
1. 全12条件の Go/No-Go 基準を PASS
2. 11項目のスモークテスト全て PASS
3. Health/Version/Admin/CRUD/PDF/Slack/Sentry 全経路が正常動作
4. TypeScript ビルド・CI 全パス
5. Railway 自動デプロイ正常動作確認済み

### 公開日に向けた残タスク（最大5件）:

1. **TEST_ データクリーンアップ** — `CKPT_TEST_PREFIX_RUNBOOK.md` の手順で TEST_ プレフィックスデータを本番DBから削除
2. **Sentry テスト Issue Resolve** — Sentry ダッシュボードでテスト用 Issue を Resolve 済みにする
3. **Sentry Alert Rule Environment 絞り込み** — Alert Rule を `All Environments` → `production` に変更（任意）
4. **メールアドレス未登録会社の対応** — ダッシュボードに表示されている未登録会社（タイガーセキュリティー他）にメールアドレスを登録
5. **公開宣言メッセージ送信** — Slack `#ky_警備報告書システム_ほうこちゃん` に公開完了メッセージを投稿

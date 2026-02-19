# Sentry Railway Setup Runbook

## A) Railway 環境変数設定手順

### 前提

- Sentry SDK はコードに導入済み（PR #282）
- DSN 未設定時はアプリが落ちない（`enabled: !!DSN` ガード）
- `VITE_*` 変数は Vite ビルド時に埋め込まれるため、設定後に **再デプロイ必須**

### 設定する環境変数（4つ）

Railway ダッシュボード → プロジェクト「respectful-embrace」→ サービス → Variables タブで以下を追加:

#### Backend 用（ランタイムで参照）

| 変数名 | 値 | 用途 |
|--------|-----|------|
| `SENTRY_DSN` | `https://3088acebc28e70223c2261491afd0307@o4510910107025408.ingest.us.sentry.io/4510910126096384` | backend エラー送信先 |
| `SENTRY_ENVIRONMENT` | `production` | Sentry 環境タグ（未設定時は NODE_ENV にフォールバック） |

#### Frontend 用（ビルド時に埋め込み）

| 変数名 | 値 | 用途 |
|--------|-----|------|
| `VITE_SENTRY_DSN` | `https://47690d3f50b00f0008518df39e933635@o4510910107025408.ingest.us.sentry.io/4510910132584448` | frontend エラー送信先 |
| `VITE_SENTRY_ENVIRONMENT` | `production` | Sentry 環境タグ |

### コード上の参照箇所

- backend: `backend/src/instrument.ts` → `process.env.SENTRY_DSN`
- frontend: `frontend/src/main.tsx` → `import.meta.env.VITE_SENTRY_DSN`

### 設定手順（クリック手順）

1. https://railway.app にログイン
2. プロジェクト「respectful-embrace」を開く
3. サービスをクリック → 「Variables」タブ
4. 「+ New Variable」で上記4つを1つずつ追加
5. 「Deploy」をクリック（再デプロイが走る）

### 設定後の確認

```bash
# ヘルスチェック
curl -s https://security-report.up.railway.app/health
# 期待: {"ok":true}

# バージョン確認
curl -s https://security-report.up.railway.app/version
# 期待: {"build":"2026-02-...","seedStatus":"skipped-enough",...}
```

両方 HTTP 200 が返れば正常。

---

## B) 本番検証 Runbook（エラー検知テスト）

### 目的

Railway 本番で Sentry にエラーイベントが届くことを確認する。

### B-1) Backend 検証

**方法**: ブラウザの DevTools コンソールから存在しない API を叩いて 500 を発生させるのではなく、`curl` で意図的に不正リクエストを送る。

ただし、現在の実装では不正リクエストは 400/404 で返るため、500 を自然に発生させるのは困難。以下の方法を推奨:

**方法 A: Sentry SDK で直接テスト送信（推奨・コード変更不要）**

Railway Shell または ローカルから:

```bash
# Node.js で直接 Sentry にテストイベントを送信
node -e "
const Sentry = require('@sentry/node');
Sentry.init({
  dsn: 'https://3088acebc28e70223c2261491afd0307@o4510910107025408.ingest.us.sentry.io/4510910126096384',
  environment: 'production-test'
});
Sentry.captureException(new Error('Backend detection test'));
Sentry.flush(5000).then(() => console.log('Sent'));
"
```

**方法 B: 一時テストエンドポイント（コード変更あり・確認後に必ず削除）**

`backend/src/index.ts` の `NODE_ENV !== 'production'` ガード内に一時追加:

```typescript
// ===== 一時テスト（確認後に削除） =====
app.get('/api/test/sentry-500', (_req: Request, res: Response) => {
  throw new Error('Sentry detection test: intentional 500');
});
// ===== ここまで =====
```

確認後は **必ず削除** して再デプロイ。

### B-2) Frontend 検証

**方法: ブラウザ DevTools コンソールから直接送信（コード変更不要）**

1. https://security-report.up.railway.app を開く
2. DevTools → Console を開く
3. 以下を実行:

```javascript
// Sentry が初期化されているか確認
const client = window.__SENTRY__ && window.__SENTRY__.hub;

// 方法1: グローバルエラーを発生させる（ErrorBoundary 経由）
setTimeout(() => { throw new Error('Frontend detection test'); }, 0);

// 方法2: Sentry SDK に直接アクセス（React アプリ内で初期化済みの場合）
// ※ Vite バンドルの場合、グローバルにエクスポートされていない可能性あり
// その場合は方法1を使用
```

**確認方法**: Sentry ダッシュボード → Issues に `Frontend detection test` が表示される。

### B-3) 検証結果の確認

Sentry ダッシュボード (https://takagigr.sentry.io/) で:

1. 左メニュー → Issues
2. プロジェクト: `houko-backend` / `houko-frontend` を選択
3. Environment: `production` でフィルタ
4. テストイベントが表示されていれば成功

確認項目:
- Event ID が存在する
- environment タグが `production` である
- stack trace が含まれている

---

## C) Sentry → Slack 通知設定 Runbook（人間が実施）

### 前提

- Sentry Organization: **Takagigr**
- Slack チャンネル: **#重大_システムエラー**
- 対象プロジェクト: **houko-backend**, **houko-frontend**

### Step 1: Slack Integration のインストール

1. https://takagigr.sentry.io/ にログイン
2. 左下の **Settings**（歯車アイコン）をクリック
3. 左メニュー → **Integrations**
4. 検索バーに `Slack` と入力
5. **Slack** を見つけて **Install** （または **Configure** ）をクリック
6. Slack の OAuth 画面で **#重大_システムエラー** があるワークスペースを選択して **Allow**

### Step 2: Alert Rule 作成（Backend）

1. 左メニュー → **Alerts**
2. 右上の **Create Alert** をクリック
3. 「Issues」を選択 → **Set Conditions**
4. プロジェクト: **houko-backend** を選択
5. Environment: **production**
6. 条件設定:
   - **When**: 「A new issue is created」
   - **If**: 「The issue's level is equal to `error`」（またはそれ以上）
7. **Then**: 「Send a Slack notification」を追加
   - Workspace: 対象ワークスペースを選択
   - Channel: `#重大_システムエラー`
8. Alert 名: `[Backend] Production Error → Slack`
9. **Save Rule** をクリック

### Step 3: Alert Rule 作成（Frontend）

1. Step 2 と同じ手順を **houko-frontend** プロジェクトで繰り返す
2. Alert 名: `[Frontend] Production Error → Slack`
3. **Save Rule** をクリック

### Step 4: 通知テスト

1. 本番検証 Runbook（上記 B）の手順でエラーを発生させる
2. **#重大_システムエラー** チャンネルに Sentry からの通知が届くことを確認
3. 通知に以下が含まれていれば成功:
   - エラータイトル
   - プロジェクト名
   - Environment: production
   - Sentry Issue へのリンク

---

## D) テスト Issue の整理（人間が実施）

### 対象

初回通知テストで作成された以下の2件を Resolve する:

- **HOUKO-BACKEND-4**: `Backend notification test: verify Slack #重大_システムエラー receives alert`
- **HOUKO-FRONTEND-3**: `Frontend notification test: verify Slack #重大_システムエラー receives alert`

### 手順（クリック手順）

1. https://takagigr.sentry.io/ にログイン
2. 左メニュー → **Issues**
3. プロジェクトフィルタで **houko-backend** を選択
4. `Backend notification test` の Issue をクリック
5. 右上の **Resolve** ボタンをクリック
6. プロジェクトフィルタを **houko-frontend** に切り替え
7. `Frontend notification test` の Issue をクリック
8. 右上の **Resolve** ボタンをクリック

Resolve 後は Issues 一覧から消える（フィルタで「Resolved」を選べば再表示可能）。

---

## E) Alert Rule の Environment を production に絞る（人間が実施）

### 背景

初回設定時は Sentry に `production` 環境がまだ存在しなかったため、Alert Rule は「All Environments」で保存された。
2026-02-19 の通知テストで `production` 環境のイベントが送信済みのため、現在は `production` が選択可能。

### 手順（クリック手順）

1. https://takagigr.sentry.io/ にログイン
2. 左メニュー → **Alerts**
3. **[Backend] Production Error → Slack** の行をクリック → 右上の **Edit Rule**（または鉛筆アイコン）
4. **Environment** ドロップダウンを `All Environments` → `production` に変更
5. **Save Rule** をクリック
6. **[Frontend] Production Error → Slack** でも同じ手順を繰り返す

### production が選べない場合

`production` 環境は、`SENTRY_ENVIRONMENT=production`（または `VITE_SENTRY_ENVIRONMENT=production`）が設定された状態でイベントが1件以上送信されると自動的に登録される。
選択肢に表示されない場合は、本番検証 Runbook（Section B）の手順でテストイベントを1件送信すれば表示されるようになる。

---

## 付録: 環境変数一覧（Sentry 関連）

| 変数名 | 側 | タイミング | 必須 | 用途 |
|--------|-----|-----------|------|------|
| `SENTRY_DSN` | backend | ランタイム | 任意 | エラー送信先（未設定時は Sentry 無効） |
| `SENTRY_ENVIRONMENT` | backend | ランタイム | 任意 | 環境タグ（未設定時は NODE_ENV） |
| `SENTRY_RELEASE` | backend | ランタイム | 任意 | リリースバージョン |
| `VITE_SENTRY_DSN` | frontend | ビルド時 | 任意 | エラー送信先（未設定時は Sentry 無効） |
| `VITE_SENTRY_ENVIRONMENT` | frontend | ビルド時 | 任意 | 環境タグ |
| `VITE_SENTRY_RELEASE` | frontend | ビルド時 | 任意 | リリースバージョン |

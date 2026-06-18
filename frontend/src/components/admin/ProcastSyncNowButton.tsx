import { useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  kind: ToastKind
  message: string
}

/**
 * 「🔄 プロキャストから今すぐ取り込み」ボタン。
 * 自動取り込み（10時/22時）を待たずに即実行できる。
 *
 * 制約:
 *  - 押下後5分間はボタンをグレーアウト（連打防止）
 *  - 認証Tokenはバックエンドが保持し、ブラウザには渡さない
 *  - 結果通知は既存のSlackチャンネル（同期開始→完了）に流れる
 */
export function ProcastSyncNowButton() {
  const [busy, setBusy] = useState(false)
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const remainSec =
    cooldownUntilMs !== null
      ? Math.max(0, Math.ceil((cooldownUntilMs - Date.now()) / 1000))
      : 0
  const disabled = busy || remainSec > 0

  async function handleClick() {
    if (disabled) return
    setBusy(true)
    setToast(null)
    try {
      const res = await fetch('/api/admin/procast-sync/trigger', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const body: { message?: string; error?: string; retryAfterSec?: number } = await res
        .json()
        .catch(() => ({}))
      if (res.status === 202) {
        setCooldownUntilMs(Date.now() + 5 * 60 * 1000)
        setToast({
          kind: 'success',
          message: body.message ?? '取り込みを開始しました。約1〜2分で完了通知がSlackに届きます。',
        })
      } else if (res.status === 429) {
        const remain = body.retryAfterSec ?? 0
        setCooldownUntilMs(Date.now() + remain * 1000)
        setToast({ kind: 'info', message: body.error ?? '直前の取り込みから5分以内です。' })
      } else if (res.status === 503) {
        setToast({
          kind: 'error',
          message: body.error ?? '今すぐ取り込み機能は未設定です（管理者にお問い合わせください）。',
        })
      } else {
        setToast({
          kind: 'error',
          message: body.error ?? `エラーが発生しました（HTTP ${res.status}）`,
        })
      }
    } catch (e) {
      setToast({
        kind: 'error',
        message: `通信エラー: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const buttonStyle: React.CSSProperties = {
    backgroundColor: disabled ? '#9aa0a6' : '#1976d2',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  }

  const toastColor =
    toast?.kind === 'success' ? '#2e7d32' : toast?.kind === 'error' ? '#c62828' : '#1565c0'
  const toastBg =
    toast?.kind === 'success' ? '#e8f5e9' : toast?.kind === 'error' ? '#ffebee' : '#e3f2fd'

  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '16px',
      }}
    >
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>
        🔄 プロキャストから今すぐ取り込み
      </h3>
      <p style={{ margin: '0 0 16px 0', color: '#555', fontSize: '13px' }}>
        自動取り込み（朝10時 / 夜22時）を待たず、いま即時にプロキャストから案件データを取り込みます。
        押下後、約1〜2分でほうこちゃんSlackチャンネルに完了通知が届きます。連打防止のため、押した後5分間はもう一度押せません。
      </p>
      <button onClick={handleClick} disabled={disabled} style={buttonStyle}>
        {busy
          ? '取り込み係を呼び出し中…'
          : remainSec > 0
            ? `あと ${remainSec} 秒で再実行可`
            : '今すぐ取り込み'}
      </button>
      {toast && (
        <div
          style={{
            marginTop: '12px',
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: toastBg,
            color: toastColor,
            fontSize: '13px',
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

import React from 'react'
import { styles } from '../../styles/adminStyles'
import type { ImportResult } from '../../types/admin'
import { ProcastSyncNowButton } from '../../components/admin/ProcastSyncNowButton'

interface CsvImportPageProps {
  importResult: ImportResult | null
  importing: boolean
  isDragging: boolean
  pendingFile: File | null
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  handleDragLeave: (e: React.DragEvent<HTMLDivElement>) => void
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void
  handleForceImport: () => void
}

export function CsvImportPage({
  importResult,
  importing,
  isDragging,
  pendingFile,
  handleFileUpload,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleForceImport,
}: CsvImportPageProps) {
  return (
    <div>
      <h2 style={styles.pageTitle}>CSV取込</h2>
      <ProcastSyncNowButton />
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>案件データのインポート</h3>
        <p style={styles.cardDesc}>案件データのCSVファイルを選択またはドラッグ＆ドロップしてインポートします。</p>
        <div 
          style={{
            ...styles.uploadArea,
            ...(isDragging ? styles.uploadAreaDragging : {})
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            disabled={importing}
            style={styles.fileInput}
            id="csv-upload"
          />
          <label htmlFor="csv-upload" style={styles.uploadLabel}>
            <span style={styles.uploadIcon}>{isDragging ? '📥' : '📁'}</span>
            <span>{importing ? 'インポート中...' : (isDragging ? 'ここにドロップ' : 'CSVファイルを選択またはドラッグ＆ドロップ')}</span>
          </label>
        </div>
        {importResult && importResult.blocked && (
          <div style={{ ...styles.resultBox, borderLeft: '4px solid #dc3545' }}>
            <h4 style={{ ...styles.resultTitle, color: '#dc3545' }}>ダブルブッキングが検出されました</h4>
            <div style={{ backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffc107', borderRadius: '6px', padding: '12px 16px', marginBottom: '16px' }}>
              <strong>前のデータを削除して上書きでインストールしますか？</strong>
              <p style={{ margin: '8px 0 0', fontSize: '14px' }}>OKを押すと、以下の既存割り当てを削除してCSVの内容で上書きします。</p>
            </div>
            {importResult.errors && importResult.errors.length > 0 && (
              <div style={{ ...styles.warningBox, marginBottom: '16px' }}>
                <strong>検出されたダブルブッキング（{importResult.errors.length}件）:</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: '20px', listStyle: 'disc' }}>
                  {importResult.errors.map((e: { row: number; reason: string }, idx: number) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>行{e.row}: {e.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {pendingFile && (
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleForceImport}
                  disabled={importing}
                  style={{ backgroundColor: '#E67E22', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {importing ? '上書き中...' : 'OK（上書きする）'}
                </button>
              </div>
            )}
          </div>
        )}
        {importResult && !importResult.blocked && (
          <div style={styles.resultBox}>
            <h4 style={styles.resultTitle}>インポート結果</h4>
            {(importResult.updated_projects_count ?? 0) > 0 && (
              <div style={styles.infoBox}>
                既存の案件を上書き更新しました（{importResult.updated_projects_count}件）
              </div>
            )}
            {(importResult.existing_projects_count ?? 0) > 0 && (importResult.created_projects_count ?? 0) === 0 && (importResult.updated_projects_count ?? 0) === 0 && (
              <div style={styles.infoBox}>
                このCSVの案件は既に登録されています（{importResult.existing_projects_count}件）
              </div>
            )}
            <div style={styles.resultGrid}>
              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>新規作成</span>
                <span style={styles.resultValue}>{importResult.created_projects_count ?? 0}件</span>
              </div>
              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>上書き更新</span>
                <span style={styles.resultValue}>{importResult.updated_projects_count ?? 0}件</span>
              </div>
              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>自動追加キャスト</span>
                <span style={styles.resultValue}>{importResult.staff_auto_added_count ?? 0}件</span>
              </div>
              <div style={styles.resultItem}>
                <span style={styles.resultLabel}>未登録会社</span>
                <span style={styles.resultValue}>{importResult.pending_client_rows_count ?? 0}件</span>
              </div>
            </div>
            {importResult.staff_without_email && importResult.staff_without_email.length > 0 && (
              <div style={{ ...styles.warningBox, backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffc107', padding: '12px 16px' }}>
                <strong>メールアドレス未登録のキャスト（{importResult.staff_without_email.length}名）:</strong>
                <div style={{ marginTop: '4px' }}>{importResult.staff_without_email.join('、')}</div>
              </div>
            )}
            {(importResult.duplicate_cast_assignments ?? 0) > 0 && (
              <div style={{ ...styles.warningBox, backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffc107' }}>
                1日2箇所以上の割り当てが {importResult.duplicate_cast_assignments} 件あります（1日1現場まで）。該当するキャストは登録されませんでした。
              </div>
            )}
            {importResult.errors && importResult.errors.length > 0 && (
              <div style={styles.warningBox}>
                <strong>エラー（{importResult.errors.length}件）:</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: '20px', listStyle: 'disc' }}>
                  {importResult.errors.map((e: { row: number; reason: string }, idx: number) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>行{e.row}: {e.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

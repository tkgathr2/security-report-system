import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StaffPage } from './StaffPage'

// 2026-09-10 バグ修正の一環：管理画面から削除したスタッフがCSVインポートで
// 復活しなかった件数(skipped_deleted)を、管理者が理由を判別できるよう表示する。
// yattaka-check-room監査：型チェック/ビルド成功だけでなく、実際にjsdomへレンダリングして
// 目視相当の検証（getByTestId等での中身確認）まで行う。

const noop = () => {}

function baseProps(staffImportResult: { inserted: number; updated: number; skipped: number; skipped_deleted?: number } | null) {
  return {
    staff: [],
    filteredStaff: [],
    loading: false,
    isMobile: false,
    staffSearchQuery: '',
    setStaffSearchQuery: noop,
    staffImporting: false,
    staffImportResult,
    setStaffImportResult: noop,
    showStaffModal: false,
    setShowStaffModal: noop,
    newStaff: { display_name_kanji: '', display_name_kana: '' },
    setNewStaff: noop,
    creating: false,
    editingStaff: null,
    setEditingStaff: noop,
    savingStaff: false,
    handleStaffCsvImport: noop,
    handleCreateStaff: noop,
    handleUpdateStaff: noop,
    handleDeleteStaff: noop,
    handleClearPin: noop,
    handleBulkClearPins: noop,
    formatDate: (s: string) => s,
  }
}

describe('StaffPage: CSVインポート結果表示', () => {
  it('skipped_deletedが無い場合は従来どおりの3件表示のみ', () => {
    render(<StaffPage {...baseProps({ inserted: 2, updated: 1, skipped: 0 })} />)
    expect(screen.getByText(/インポート完了: 追加 2件、更新 1件、スキップ 0件/)).toBeInTheDocument()
    expect(screen.queryByText(/削除済みのため復活させなかった/)).not.toBeInTheDocument()
  })

  it('skipped_deletedが1件以上のとき、理由の内訳を表示する（管理者への説明責任）', () => {
    render(<StaffPage {...baseProps({ inserted: 0, updated: 0, skipped: 1, skipped_deleted: 1 })} />)
    expect(screen.getByText(/インポート完了: 追加 0件、更新 0件、スキップ 1件/)).toBeInTheDocument()
    expect(screen.getByText(/削除済みのため復活させなかった: 1件/)).toBeInTheDocument()
  })

  it('skipped_deletedが0のときは内訳を表示しない（0件を紛らわしく見せない）', () => {
    render(<StaffPage {...baseProps({ inserted: 1, updated: 0, skipped: 0, skipped_deleted: 0 })} />)
    expect(screen.queryByText(/削除済みのため復活させなかった/)).not.toBeInTheDocument()
  })
})

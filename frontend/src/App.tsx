import { useState, useEffect, useMemo } from 'react'

interface Recipient {
  id: string
  company_name: string
  contact_name: string
  email: string
  is_active?: boolean
}

interface GroupedRecipients {
  [company: string]: Recipient[]
}

function App() {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [grouped, setGrouped] = useState<GroupedRecipients>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reportId = new URLSearchParams(window.location.search).get('reportId') || ''

  useEffect(() => {
    fetchRecipients()
    if (reportId) {
      fetchSelectedRecipients()
    }
  }, [reportId])

  const fetchRecipients = async () => {
    try {
      const response = await fetch('/api/admin/recipients', {
        credentials: 'include'
      })
      if (!response.ok) {
        if (response.status === 401) {
          setError('ログインが必要です。管理者としてログインしてください。')
          return
        }
        throw new Error('Failed to fetch recipients')
      }
      const data = await response.json()
      setRecipients(data.recipients)
      setGrouped(data.grouped)
      setExpandedCompanies(new Set(Object.keys(data.grouped)))
    } catch (err) {
      setError('送付先の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const fetchSelectedRecipients = async () => {
    try {
      const response = await fetch(`/api/admin/recipients/for-report/${reportId}`, {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        setSelectedIds(new Set(data.recipients.map((r: Recipient) => r.id)))
      }
    } catch (err) {
      console.error('Failed to fetch selected recipients:', err)
    }
  }

  const filteredGrouped = useMemo(() => {
    if (!searchQuery.trim()) {
      return grouped
    }
    const query = searchQuery.toLowerCase()
    const result: GroupedRecipients = {}
    
    for (const [company, contacts] of Object.entries(grouped)) {
      const filteredContacts = contacts.filter(
        c => c.company_name.toLowerCase().includes(query) ||
             c.contact_name.toLowerCase().includes(query) ||
             c.email.toLowerCase().includes(query)
      )
      if (filteredContacts.length > 0) {
        result[company] = filteredContacts
      }
    }
    return result
  }, [grouped, searchQuery])

  const toggleCompanyExpand = (company: string) => {
    const newExpanded = new Set(expandedCompanies)
    if (newExpanded.has(company)) {
      newExpanded.delete(company)
    } else {
      newExpanded.add(company)
    }
    setExpandedCompanies(newExpanded)
  }

  const toggleContact = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const toggleCompany = (company: string) => {
    const contacts = filteredGrouped[company] || []
    const allSelected = contacts.every(c => selectedIds.has(c.id))
    const newSelected = new Set(selectedIds)
    
    if (allSelected) {
      contacts.forEach(c => newSelected.delete(c.id))
    } else {
      contacts.forEach(c => newSelected.add(c.id))
    }
    setSelectedIds(newSelected)
  }

  const isCompanySelected = (company: string): boolean => {
    const contacts = filteredGrouped[company] || []
    return contacts.length > 0 && contacts.every(c => selectedIds.has(c.id))
  }

  const isCompanyPartiallySelected = (company: string): boolean => {
    const contacts = filteredGrouped[company] || []
    const selectedCount = contacts.filter(c => selectedIds.has(c.id)).length
    return selectedCount > 0 && selectedCount < contacts.length
  }

  const selectedRecipients = useMemo(() => {
    return recipients.filter(r => selectedIds.has(r.id))
  }, [recipients, selectedIds])

  const uniqueEmails = useMemo(() => {
    const emails = selectedRecipients.map(r => r.email.toLowerCase())
    return [...new Set(emails)]
  }, [selectedRecipients])

  const handleSave = async () => {
    if (!reportId) {
      setError('報告書IDが指定されていません')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/admin/recipients/for-report/${reportId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          recipient_ids: Array.from(selectedIds)
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '保存に失敗しました')
      }

      const data = await response.json()
      setSuccess(`宛先を保存しました（${data.recipient_count}件、ユニークメール${data.unique_email_count}件）`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="container"><div className="loading">読み込み中...</div></div>
  }

  return (
    <div className="container">
      <div className="main-content">
        <h1>送付先選択</h1>
        
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}

        <input
          type="text"
          className="search-box"
          placeholder="会社名・担当者名・メールで検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {Object.keys(filteredGrouped).length === 0 ? (
          <div className="loading">
            {searchQuery ? '検索結果がありません' : '送付先が登録されていません'}
          </div>
        ) : (
          Object.entries(filteredGrouped).map(([company, contacts]) => (
            <div key={company} className="company-group">
              <div className="company-header" onClick={() => toggleCompanyExpand(company)}>
                <input
                  type="checkbox"
                  className="company-checkbox"
                  checked={isCompanySelected(company)}
                  ref={(el) => {
                    if (el) el.indeterminate = isCompanyPartiallySelected(company)
                  }}
                  onChange={(e) => {
                    e.stopPropagation()
                    toggleCompany(company)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="company-name">{company}</span>
                <span className="company-count">{contacts.length}名</span>
                <span className={`toggle-icon ${expandedCompanies.has(company) ? 'expanded' : ''}`}>
                  ▼
                </span>
              </div>
              
              {expandedCompanies.has(company) && (
                <div className="contacts-list">
                  {contacts.map(contact => (
                    <div key={contact.id} className="contact-item">
                      <input
                        type="checkbox"
                        className="contact-checkbox"
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                      />
                      <div className="contact-info">
                        <div className="contact-name">{contact.contact_name}</div>
                        <div className="contact-email">{contact.email}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="summary-panel">
        <div className="summary-content">
          <div className="summary-header">
            <div>
              <span className="summary-count">
                選択済み: {selectedRecipients.length}件
                {selectedRecipients.length !== uniqueEmails.length && 
                  ` (ユニークメール: ${uniqueEmails.length}件)`
                }
              </span>
            </div>
            <button 
              className="save-button" 
              onClick={handleSave}
              disabled={saving || !reportId || selectedIds.size === 0}
            >
              {saving ? '保存中...' : '宛先を保存'}
            </button>
          </div>
          <div className="summary-emails">
            {uniqueEmails.length > 0 
              ? uniqueEmails.join(', ')
              : '宛先が選択されていません'
            }
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

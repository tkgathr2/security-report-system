import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import SignatureModal from '../components/SignatureModal'

interface Project {
  id: string
  project_key: string
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
  status: string
  unique_url: string
  staff_name: string
}

interface Draft {
  payload_json: {
    supervisor_name?: string
    weather?: string
    guard_contents?: string[]
    guard_contents_other?: string
    overtime_hours?: number
    has_qualifier?: boolean
    notes?: string
  }
  updated_at: string
}

type PageState = 'loading' | 'error' | 'expired' | 'completed' | 'form' | 'success'

const WEATHER_OPTIONS = [
  { value: 'sunny', label: '晴れ' },
  { value: 'cloudy', label: '曇り' },
  { value: 'rainy', label: '雨' },
  { value: 'snowy', label: '雪' }
]

const GUARD_CONTENTS = [
  { value: 'traffic', label: '①交通誘導' },
  { value: 'pedestrian', label: '②歩行者誘導' },
  { value: 'construction', label: '③工事関係者、車両の誘導' },
  { value: 'worker_safety', label: '④作業員の安全確保' },
  { value: 'property_safety', label: '⑤占有物の安全確保' },
  { value: 'detour', label: '⑥通行止・迂回案内' },
  { value: 'alternating', label: '⑦交互通行' },
  { value: 'other', label: '⑧その他' }
]

export default function FieldReport() {
  const { uniqueUrl } = useParams<{ uniqueUrl: string }>()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [project, setProject] = useState<Project | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  
  const [token, setToken] = useState<string | null>(null)
  const [showSignatureModal, setShowSignatureModal] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)
  
  const [supervisorName, setSupervisorName] = useState('')
  const [weather, setWeather] = useState('sunny')
  const [guardContents, setGuardContents] = useState<string[]>([])
  const [guardContentsOther, setGuardContentsOther] = useState('')
  const [overtimeHours, setOvertimeHours] = useState(0)
  const [hasQualifier, setHasQualifier] = useState(false)
  const [notes, setNotes] = useState('')
  
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (uniqueUrl) {
      fetchProject()
    }
  }, [uniqueUrl])

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${uniqueUrl}`)
      
      if (response.status === 404) {
        setErrorMessage('案件が見つかりません')
        setPageState('error')
        return
      }
      
      if (response.status === 410) {
        setPageState('expired')
        return
      }
      
      if (response.status === 303) {
        setPageState('completed')
        return
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch project')
      }
      
      const data = await response.json()
      setProject(data.project)
      
      await authenticateCast(data.project.staff_name)
    } catch {
      setErrorMessage('案件の取得に失敗しました')
      setPageState('error')
    }
  }

    const authenticateCast = async (_staffName: string) => {
      try {
        const email = `cast-${uniqueUrl}@field.local`
        const pin = '0000'
      
        let response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, pin })
        })
      
        if (response.status === 401) {
          response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, pin })
          })
        }
      
        if (!response.ok) {
          throw new Error('Authentication failed')
        }
      
        const data = await response.json()
        setToken(data.token)
      
        await fetchDraft(data.token)
        setPageState('form')
      
        // Show tutorial on first visit
        if (!localStorage.getItem('tutorial_shown')) {
          setShowTutorial(true)
          localStorage.setItem('tutorial_shown', 'true')
        }
      } catch {
        setErrorMessage('認証に失敗しました')
        setPageState('error')
      }
    }

  const fetchDraft = async (authToken: string) => {
    try {
      const response = await fetch(`/api/drafts/${uniqueUrl}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      
      if (response.ok) {
        const data: Draft = await response.json()
        if (data.payload_json) {
          setSupervisorName(data.payload_json.supervisor_name || '')
          setWeather(data.payload_json.weather || 'sunny')
          setGuardContents(data.payload_json.guard_contents || [])
          setGuardContentsOther(data.payload_json.guard_contents_other || '')
          setOvertimeHours(data.payload_json.overtime_hours || 0)
          setHasQualifier(data.payload_json.has_qualifier || false)
          setNotes(data.payload_json.notes || '')
        }
      }
    } catch {
      // Draft not found is OK
    }
  }

  const saveDraft = async () => {
    if (!token) return
    
    try {
      await fetch(`/api/drafts/${uniqueUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          payload_json: {
            supervisor_name: supervisorName,
            weather,
            guard_contents: guardContents,
            guard_contents_other: guardContentsOther,
            overtime_hours: overtimeHours,
            has_qualifier: hasQualifier,
            notes
          },
          client_updated_at: new Date().toISOString()
        })
      })
    } catch {
      // Ignore draft save errors
    }
  }

  const handleGuardContentToggle = (value: string) => {
    setGuardContents(prev => 
      prev.includes(value) 
        ? prev.filter(v => v !== value)
        : [...prev, value]
    )
  }

  const handleSignatureSave = (dataUrl: string) => {
    setSignatureDataUrl(dataUrl)
  }

  const handleSubmit = async () => {
    if (!token || !signatureDataUrl || !supervisorName) return
    
    setSubmitting(true)
    
    try {
      await saveDraft()
      
      const base64Data = signatureDataUrl.split(',')[1]
      
      const response = await fetch('/api/reports/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          project_unique_url: uniqueUrl,
          supervisor_name: supervisorName,
          weather,
          guard_contents: guardContents,
          guard_other_text: guardContentsOther,
          overtime_hours: overtimeHours,
          has_qualifier: hasQualifier,
          notes,
          signature_png_base64: base64Data
        })
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '送信に失敗しました')
      }
      
      setPageState('success')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '送信に失敗しました')
      setSubmitting(false)
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  if (pageState === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.loadingBox}>
          <p>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (pageState === 'error') {
    return (
      <div style={styles.container}>
        <div style={styles.errorBox}>
          <h2>エラー</h2>
          <p>{errorMessage}</p>
        </div>
      </div>
    )
  }

  if (pageState === 'expired') {
    return (
      <div style={styles.container}>
        <div style={styles.expiredBox}>
          <h2>URLの有効期限が切れています</h2>
          <p>このURLは有効期限が切れています。管理者にお問い合わせください。</p>
        </div>
      </div>
    )
  }

  if (pageState === 'completed') {
    return (
      <div style={styles.container}>
        <div style={styles.completedBox}>
          <h2>報告書は既に提出済みです</h2>
          <p>この案件の報告書は既に提出されています。</p>
        </div>
      </div>
    )
  }

  if (pageState === 'success') {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <div style={styles.successIcon}>&#10003;</div>
          <h2>報告書を送信しました</h2>
          <p>ご協力ありがとうございました。</p>
        </div>
      </div>
    )
  }

  const isFormValid = supervisorName.trim() !== '' && signatureDataUrl !== null && guardContents.length > 0

  const handleCloseTutorial = () => {
    setShowTutorial(false)
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.headerTitle}>ほうこちゃん</h1>
            <p style={styles.headerSubtitle}>警備報告書</p>
          </div>
          <button 
            style={styles.helpButton}
            onClick={() => setShowTutorial(true)}
          >
            使い方
          </button>
        </div>
      </header>

      <main style={styles.main}>
        {project && (
          <section style={styles.projectInfo}>
            <h2 style={styles.sectionTitle}>案件情報</h2>
            <div style={styles.infoGrid}>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>会社名</span>
                <span style={styles.infoValue}>{project.client_name_raw}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>実施日</span>
                <span style={styles.infoValue}>{formatDate(project.work_date)}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>作業名</span>
                <span style={styles.infoValue}>{project.work_name}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>場所</span>
                <span style={styles.infoValue}>{project.location}</span>
              </div>
            </div>
          </section>
        )}

        <section style={styles.formSection}>
          <h2 style={styles.sectionTitle}>報告内容</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>監督者名 <span style={styles.required}>*</span></label>
            <input
              type="text"
              style={styles.input}
              value={supervisorName}
              onChange={(e) => setSupervisorName(e.target.value)}
              onBlur={saveDraft}
              placeholder="監督者のお名前"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>天気</label>
            <div style={styles.radioGroup}>
              {WEATHER_OPTIONS.map(option => (
                <label key={option.value} style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="weather"
                    value={option.value}
                    checked={weather === option.value}
                    onChange={(e) => setWeather(e.target.value)}
                    style={styles.radio}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>警備内容 <span style={styles.required}>*</span></label>
            <div style={styles.checkboxGroup}>
              {GUARD_CONTENTS.map(option => (
                <label key={option.value} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={guardContents.includes(option.value)}
                    onChange={() => handleGuardContentToggle(option.value)}
                    style={styles.checkbox}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {guardContents.includes('other') && (
              <input
                type="text"
                style={styles.otherInput}
                value={guardContentsOther}
                onChange={(e) => setGuardContentsOther(e.target.value)}
                onBlur={saveDraft}
                placeholder="その他の内容を入力してください"
              />
            )}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>残業時間</label>
            <div style={styles.numberInputWrapper}>
              <input
                type="number"
                style={styles.numberInput}
                value={overtimeHours}
                onChange={(e) => setOvertimeHours(Number(e.target.value))}
                onBlur={saveDraft}
                min={0}
                max={24}
              />
              <span style={styles.numberUnit}>時間</span>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={hasQualifier}
                onChange={(e) => setHasQualifier(e.target.checked)}
                style={styles.checkbox}
              />
              有資格者による作業あり
            </label>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>備考</label>
            <textarea
              style={styles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveDraft}
              placeholder="特記事項があれば入力してください"
              rows={3}
            />
          </div>
        </section>

        <section style={styles.signatureSection}>
          <h2 style={styles.sectionTitle}>署名 <span style={styles.required}>*</span></h2>
          <p style={styles.signatureHint}>下の枠をタップして署名してください</p>
          
          <div 
            style={signatureDataUrl ? styles.signatureBoxFilled : styles.signatureBox}
            onClick={() => setShowSignatureModal(true)}
          >
            {signatureDataUrl ? (
              <img src={signatureDataUrl} alt="署名" style={styles.signatureImage} />
            ) : (
              <span style={styles.signaturePlaceholder}>タップして署名</span>
            )}
          </div>
          
          {signatureDataUrl && (
            <button 
              style={styles.resignButton}
              onClick={() => setShowSignatureModal(true)}
            >
              署名をやり直す
            </button>
          )}
        </section>

        <section style={styles.submitSection}>
          <button
            style={isFormValid ? styles.submitButton : styles.submitButtonDisabled}
            onClick={handleSubmit}
            disabled={!isFormValid || submitting}
          >
            {submitting ? '送信中...' : '報告書を送信'}
          </button>
          {!isFormValid && (
            <p style={styles.submitHint}>
              監督者名、警備内容（1つ以上）、署名を入力してください
            </p>
          )}
        </section>
      </main>

      <SignatureModal
        isOpen={showSignatureModal}
        onClose={() => setShowSignatureModal(false)}
        onSave={handleSignatureSave}
      />

      {showTutorial && (
        <div style={styles.tutorialOverlay} onClick={handleCloseTutorial}>
          <div style={styles.tutorialCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.tutorialHeader}>
              <h2 style={styles.tutorialTitle}>使い方ガイド</h2>
              <button style={styles.tutorialCloseBtn} onClick={handleCloseTutorial}>&times;</button>
            </div>
            <div style={styles.tutorialContent}>
              <div style={styles.tutorialSection}>
                <h3 style={styles.tutorialSectionTitle}>1. 案件情報の確認</h3>
                <p style={styles.tutorialText}>画面上部に表示される会社名、実施日、作業名、場所を確認してください。</p>
              </div>
              <div style={styles.tutorialSection}>
                <h3 style={styles.tutorialSectionTitle}>2. 報告内容の入力</h3>
                <p style={styles.tutorialText}>監督者名（必須）、天気、警備内容（1つ以上必須）、残業時間、備考を入力してください。</p>
              </div>
              <div style={styles.tutorialSection}>
                <h3 style={styles.tutorialSectionTitle}>3. 署名</h3>
                <p style={styles.tutorialText}>「タップして署名」をタップし、指またはペンで署名を描いてください。署名は必須です。</p>
              </div>
              <div style={styles.tutorialSection}>
                <h3 style={styles.tutorialSectionTitle}>4. 送信</h3>
                <p style={styles.tutorialText}>すべての必須項目を入力後、「報告書を送信」ボタンをタップして完了です。</p>
              </div>
            </div>
            <button style={styles.tutorialOkBtn} onClick={handleCloseTutorial}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '20px'
  },
  loadingBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    textAlign: 'center'
  },
  errorBox: {
    backgroundColor: '#fee',
    padding: '40px',
    borderRadius: '8px',
    textAlign: 'center',
    color: '#c00'
  },
  expiredBox: {
    backgroundColor: '#fff3cd',
    padding: '40px',
    borderRadius: '8px',
    textAlign: 'center',
    color: '#856404'
  },
  completedBox: {
    backgroundColor: '#d4edda',
    padding: '40px',
    borderRadius: '8px',
    textAlign: 'center',
    color: '#155724'
  },
  successBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    textAlign: 'center'
  },
  successIcon: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    backgroundColor: '#4caf50',
    color: 'white',
    fontSize: '48px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    margin: '0 auto 20px'
  },
  page: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  header: {
    backgroundColor: '#333',
    color: 'white',
    padding: '20px',
    textAlign: 'center'
  },
  headerTitle: {
    margin: 0,
    fontSize: '24px'
  },
  headerSubtitle: {
    margin: '5px 0 0',
    fontSize: '14px',
    opacity: 0.8
  },
  main: {
    padding: '20px',
    maxWidth: '600px',
    margin: '0 auto'
  },
  projectInfo: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px'
  },
  sectionTitle: {
    margin: '0 0 15px',
    fontSize: '18px',
    color: '#333',
    borderBottom: '2px solid #333',
    paddingBottom: '10px'
  },
  infoGrid: {
    display: 'grid',
    gap: '10px'
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column'
  },
  infoLabel: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '2px'
  },
  infoValue: {
    fontSize: '16px',
    color: '#333'
  },
  formSection: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px'
  },
  formGroup: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333'
  },
  required: {
    color: '#c00'
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box'
  },
  radioGroup: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '15px'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  radio: {
    width: '18px',
    height: '18px'
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  checkbox: {
    width: '20px',
    height: '20px'
  },
  numberInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  numberInput: {
    width: '80px',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    textAlign: 'center'
  },
  numberUnit: {
    fontSize: '14px',
    color: '#666'
  },
  textarea: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box',
    resize: 'vertical'
  },
  signatureSection: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px'
  },
  signatureHint: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '10px'
  },
  signatureBox: {
    border: '2px dashed #ccc',
    borderRadius: '8px',
    height: '150px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
    backgroundColor: '#fafafa'
  },
  signatureBoxFilled: {
    border: '2px solid #4caf50',
    borderRadius: '8px',
    height: '150px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
    backgroundColor: 'white',
    padding: '10px'
  },
  signaturePlaceholder: {
    color: '#999',
    fontSize: '16px'
  },
  signatureImage: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain'
  },
  resignButton: {
    marginTop: '10px',
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #ddd',
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  submitSection: {
    marginBottom: '40px'
  },
  submitButton: {
    width: '100%',
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    padding: '18px',
    borderRadius: '8px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  submitButtonDisabled: {
    width: '100%',
    backgroundColor: '#ccc',
    color: '#666',
    border: 'none',
    padding: '18px',
    borderRadius: '8px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'not-allowed'
  },
  submitHint: {
    textAlign: 'center',
    fontSize: '14px',
    color: '#999',
    marginTop: '10px'
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '600px',
    margin: '0 auto'
  },
  helpButton: {
    backgroundColor: 'transparent',
    color: 'white',
    border: '1px solid white',
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  tutorialOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  tutorialCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto'
  },
  tutorialHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 24px 0 24px'
  },
  tutorialTitle: {
    fontSize: '20px',
    fontWeight: 700,
    margin: 0
  },
  tutorialCloseBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: '#666'
  },
  tutorialContent: {
    padding: '20px 24px',
    fontSize: '14px',
    lineHeight: 1.8
  },
  tutorialSection: {
    marginBottom: '20px'
  },
  tutorialSectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '8px',
    color: '#333'
  },
  tutorialText: {
    margin: 0,
    color: '#666'
  },
  tutorialOkBtn: {
    margin: '0 24px 24px 24px',
    width: 'calc(100% - 48px)',
    padding: '12px',
    backgroundColor: '#333',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  otherInput: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box',
    marginTop: '10px'
  }
}

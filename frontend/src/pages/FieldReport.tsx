import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import SignatureModal from '../components/SignatureModal'
import './FieldReport.css'

interface ProjectCast {
  staff_no: string
  name: string
}

interface Project {
  id: string
  project_key: string
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
  start_time: string | null
  end_time: string | null
  status: string
  unique_url: string
  staff_name: string
  has_qualifier: boolean
  casts: ProjectCast[]
}

interface Draft {
  payload_json: {
    supervisor_name?: string
    writer_name?: string
    weather?: string
    guard_contents?: string[]
    guard_other_text?: string
    guards?: { index: number; name: string; start_time: string; end_time: string; early_overtime_hours?: number | null }[]
    has_qualifier?: boolean
    qualifier_name?: string
    notes?: string
  }
  updated_at: string
}

type PageState = 'loading' | 'error' | 'expired' | 'completed' | 'email_registration' | 'name_selection' | 'name_confirmation' | 'form' | 'success'

interface StaffMember {
  id: string
  displayNameKanji: string
  displayNameKana: string
}

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
  const [searchParams] = useSearchParams()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [project, setProject] = useState<Project | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  
  const [token, setToken] = useState<string | null>(null)
  const [showSignatureModal, setShowSignatureModal] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)
  
    const [emailInput, setEmailInput] = useState('')
    const [emailError, setEmailError] = useState('')
    const [registering, setRegistering] = useState(false)
  
    const [nameSearchQuery, setNameSearchQuery] = useState('')
    const [nameSearchResults, setNameSearchResults] = useState<StaffMember[]>([])
    const [nameSearching, setNameSearching] = useState(false)
    const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  
  const [supervisorName, setSupervisorName] = useState('')
  const [writerName, setWriterName] = useState('')
  const [writerEmail, setWriterEmail] = useState('')
  const [weather, setWeather] = useState('sunny')
  const [guardContents, setGuardContents] = useState<string[]>([])
  const [guardContentsOther, setGuardContentsOther] = useState('')
  const [guards, setGuards] = useState<{ index: number; name: string; start_time: string; end_time: string; early_overtime_hours?: number | null }[]>([])
  const [dbCastCount, setDbCastCount] = useState(0)
  const [hasQualifier, setHasQualifier] = useState(false)
  const [qualifierName, setQualifierName] = useState('')
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
      
      if (response.status === 403) {
        setErrorMessage('この案件は会社が未登録のため、報告書を作成できません。管理者にお問い合わせください。')
        setPageState('error')
        return
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch project')
      }
      
      const data = await response.json()
      setProject(data.project)
      
      const savedEmail = localStorage.getItem(`writer_email_${uniqueUrl}`)
      const queryEmail = searchParams.get('email')
      const emailToUse = savedEmail || queryEmail
      if (emailToUse) {
        setWriterEmail(emailToUse)
        setWriterName(emailToUse)
        await authenticateWithEmail(emailToUse, data.project)
      } else {
        setPageState('email_registration')
      }
    } catch {
      setErrorMessage('案件の取得に失敗しました')
      setPageState('error')
    }
  }

    const authenticateWithEmail = async (email: string, projectData: Project) => {
      try {
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

        localStorage.setItem(`writer_email_${uniqueUrl}`, email)
      
        initializeFormFromProject(projectData)
      
        const savedStaffId = localStorage.getItem(`selected_staff_id_${uniqueUrl}`)
        const savedStaffName = localStorage.getItem(`selected_staff_name_${uniqueUrl}`)
      
        const staffId = savedStaffId || data.user?.staff_id
        const staffName = savedStaffName || data.user?.staff_name

        if (staffId && staffName) {
          localStorage.setItem(`selected_staff_id_${uniqueUrl}`, staffId)
          localStorage.setItem(`selected_staff_name_${uniqueUrl}`, staffName)
          setSelectedStaff({
            id: staffId,
            displayNameKanji: staffName,
            displayNameKana: ''
          })
          await fetchDraft(data.token)
          setPageState('form')
        
          if (!localStorage.getItem('tutorial_shown')) {
            setShowTutorial(true)
            localStorage.setItem('tutorial_shown', 'true')
          }
        } else {
          setPageState('name_selection')
        }
      } catch {
        setErrorMessage('認証に失敗しました')
        setPageState('error')
      }
    }

  const initializeFormFromProject = (projectData: Project) => {
    if (projectData.has_qualifier) {
      setHasQualifier(true)
    }
    
    if (projectData.casts && projectData.casts.length > 0) {
      setDbCastCount(projectData.casts.length)
      const initialGuards = projectData.casts.map((cast, idx) => ({
        index: idx + 1,
        name: cast.name,
        start_time: projectData.start_time || '',
        end_time: projectData.end_time || '',
        early_overtime_hours: null
      }))
      setGuards(initialGuards)
    }
  }

  const handleEmailRegistration = async () => {
    if (!emailInput.trim()) {
      setEmailError('メールアドレスを入力してください')
      return
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailInput)) {
      setEmailError('有効なメールアドレスを入力してください')
      return
    }
    
    setRegistering(true)
    setEmailError('')
    
    try {
      setWriterEmail(emailInput)
      setWriterName(emailInput)
      
      if (project) {
        await authenticateWithEmail(emailInput, project)
      }
    } catch {
      setEmailError('登録に失敗しました')
      setRegistering(false)
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
          setWriterName(data.payload_json.writer_name || '')
          setWeather(data.payload_json.weather || 'sunny')
          setGuardContents(data.payload_json.guard_contents || [])
          setGuardContentsOther(data.payload_json.guard_other_text || '')
          setGuards(data.payload_json.guards || [])
          setHasQualifier(data.payload_json.has_qualifier || false)
          setQualifierName(data.payload_json.qualifier_name || '')
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
            writer_name: writerName,
            weather,
            guard_contents: guardContents,
            guard_other_text: guardContentsOther,
            guards,
            has_qualifier: hasQualifier,
            qualifier_name: qualifierName,
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
          writer_name: writerName,
          weather,
          guard_contents: guardContents,
          guard_other_text: guardContentsOther,
          guards,
          has_qualifier: hasQualifier,
          qualifier_name: hasQualifier ? qualifierName : null,
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

    const handleNameSearch = async (query: string) => {
      setNameSearchQuery(query)
    
      if (!query.trim() || !token) {
        setNameSearchResults([])
        return
      }
    
      setNameSearching(true)
      try {
        const response = await fetch(`/api/staff/search?q=${encodeURIComponent(query)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      
        if (response.ok) {
          const data = await response.json()
          setNameSearchResults(data.staff || [])
        }
      } catch {
        // Ignore search errors
      } finally {
        setNameSearching(false)
      }
    }

    const handleStaffSelect = (staff: StaffMember) => {
      setSelectedStaff(staff)
      setPageState('name_confirmation')
    }

    const handleNameConfirm = async () => {
      if (!selectedStaff || !token) return
    
      try {
        const response = await fetch('/api/staff/select', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            staff_id: selectedStaff.id,
            staff_name_kanji: selectedStaff.displayNameKanji
          })
        })
      
        if (!response.ok) {
          throw new Error('Failed to save name selection')
        }
      
        localStorage.setItem(`selected_staff_id_${uniqueUrl}`, selectedStaff.id)
        localStorage.setItem(`selected_staff_name_${uniqueUrl}`, selectedStaff.displayNameKanji)
      
        await fetchDraft(token)
        setPageState('form')
      
        if (!localStorage.getItem('tutorial_shown')) {
          setShowTutorial(true)
          localStorage.setItem('tutorial_shown', 'true')
        }
      } catch {
        setErrorMessage('名前の保存に失敗しました')
        setPageState('error')
      }
    }

    const handleNameReject = () => {
      setSelectedStaff(null)
      setNameSearchQuery('')
      setNameSearchResults([])
      setPageState('name_selection')
    }

    const handleChangeRegistration = () => {
      localStorage.removeItem(`selected_staff_id_${uniqueUrl}`)
      localStorage.removeItem(`selected_staff_name_${uniqueUrl}`)
      setSelectedStaff(null)
      setNameSearchQuery('')
      setNameSearchResults([])
      setPageState('name_selection')
    }

    const handleCtrlEnterSubmit = useCallback((e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (pageState === 'email_registration' && !registering) {
          handleEmailRegistration()
        } else if (pageState === 'form' && !submitting) {
          handleSubmit()
        }
      }
    }, [pageState, registering, submitting])

    useEffect(() => {
      document.addEventListener('keydown', handleCtrlEnterSubmit)
      return () => document.removeEventListener('keydown', handleCtrlEnterSubmit)
    }, [handleCtrlEnterSubmit])

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
          <h2>お仕事お疲れ様でした</h2>
          <p>すぐメールが行くので確認してください</p>
        </div>
      </div>
    )
  }

    if (pageState === 'email_registration') {
      return (
        <div style={styles.container}>
          <div style={styles.emailRegistrationBox}>
            <h2 style={styles.emailRegistrationTitle}>メールアドレス登録</h2>
            <p style={styles.emailRegistrationDesc}>
              報告書の記入者として登録するメールアドレスを入力してください。
              このメールアドレスは報告書送信時の通知先にもなります。
            </p>
            <div style={styles.emailInputGroup}>
              <input
                type="email"
                style={styles.emailInput}
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleEmailRegistration() }}
                placeholder="example@email.com"
                disabled={registering}
              />
              {emailError && <p style={styles.emailErrorText}>{emailError}</p>}
            </div>
            <button
              style={registering ? styles.emailButtonDisabled : styles.emailButton}
              onClick={handleEmailRegistration}
              disabled={registering}
            >
              {registering ? '登録中...' : '登録して報告書を作成'}
            </button>
          </div>
        </div>
      )
    }

    if (pageState === 'name_selection') {
      return (
        <div style={styles.container}>
          <div style={styles.nameSelectionBox}>
            <h2 style={styles.nameSelectionTitle}>お名前を選択してください</h2>
            <p style={styles.nameSelectionDesc}>
              カタカナでお名前を検索し、候補から選択してください。
            </p>
            <div style={styles.nameSearchInputGroup}>
              <input
                type="text"
                style={styles.nameSearchInput}
                value={nameSearchQuery}
                onChange={(e) => handleNameSearch(e.target.value)}
                placeholder="カタカナで名前を入力（例：ヤマダ タロウ）"
              />
              {nameSearching && <p style={styles.searchingText}>検索中...</p>}
            </div>
            {nameSearchResults.length > 0 && (
              <div style={styles.nameSearchResults}>
                {nameSearchResults.map((staff) => (
                  <button
                    key={staff.id}
                    style={styles.nameResultItem}
                    onClick={() => handleStaffSelect(staff)}
                  >
                    <span style={styles.nameKanji}>{staff.displayNameKanji}</span>
                    <span style={styles.nameKana}>（{staff.displayNameKana}）</span>
                  </button>
                ))}
              </div>
            )}
            {nameSearchQuery.trim() && !nameSearching && nameSearchResults.length === 0 && (
              <p style={styles.noResultsText}>該当する名前が見つかりません</p>
            )}
          </div>
        </div>
      )
    }

    if (pageState === 'name_confirmation') {
      return (
        <div style={styles.container}>
          <div style={styles.nameConfirmationBox}>
            <h2 style={styles.nameConfirmationTitle}>確認</h2>
            <p style={styles.nameConfirmationQuestion}>
              あなたは『<strong>{selectedStaff?.displayNameKanji}</strong>』で間違いありませんか？
            </p>
            <div style={styles.confirmationButtons}>
              <button
                style={styles.confirmYesButton}
                onClick={handleNameConfirm}
              >
                はい
              </button>
              <button
                style={styles.confirmNoButton}
                onClick={handleNameReject}
              >
                違います
              </button>
            </div>
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
            <h1 style={styles.headerTitle}>デジタル警備報告書システム【ほうこちゃん】</h1>
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
            <label style={styles.label}>記入者（メールアドレス）</label>
            <input
              type="text"
              style={styles.inputReadonly}
              value={writerEmail || writerName}
              readOnly
              disabled
            />
          </div>

          {selectedStaff && (
            <div style={styles.formGroup}>
              <label style={styles.label}>登録名</label>
              <div style={styles.registeredNameBox}>
                <span style={styles.registeredName}>{selectedStaff.displayNameKanji}</span>
                <button
                  type="button"
                  style={styles.changeRegistrationButton}
                  onClick={handleChangeRegistration}
                >
                  登録情報を変更
                </button>
              </div>
            </div>
          )}

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
            <label style={styles.label}>
              警備員（最大8名）
              {dbCastCount > 1 && (
                <span style={styles.multiCastBadge}>
                  {dbCastCount}人分の報告書（DB連携済み）
                </span>
              )}
            </label>
            <div>
              {guards.map((g, idx) => (
                <div key={g.index} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr 1.2fr auto', gap: '8px', marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder={`氏名 #${g.index}`}
                    value={g.name}
                    onChange={(e) => {
                      const v = [...guards];
                      v[idx] = { ...v[idx], name: e.target.value };
                      setGuards(v);
                    }}
                    onBlur={saveDraft}
                    style={idx < dbCastCount ? styles.inputDbLinked : styles.input}
                    readOnly={idx < dbCastCount}
                  />
                  <input
                    type="time"
                    value={g.start_time}
                    onChange={(e) => {
                      const v = [...guards];
                      v[idx] = { ...v[idx], start_time: e.target.value };
                      setGuards(v);
                    }}
                    onBlur={saveDraft}
                    style={styles.input}
                  />
                  <input
                    type="time"
                    value={g.end_time}
                    onChange={(e) => {
                      const v = [...guards];
                      v[idx] = { ...v[idx], end_time: e.target.value };
                      setGuards(v);
                    }}
                    onBlur={saveDraft}
                    style={styles.input}
                  />
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    placeholder="早出残業(h)"
                    value={g.early_overtime_hours ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      const v = [...guards];
                      v[idx] = { ...v[idx], early_overtime_hours: val };
                      setGuards(v);
                    }}
                    onBlur={saveDraft}
                    style={styles.numberInput}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = guards.filter((_, i) => i !== idx);
                      // 再採番
                      setGuards(v.map((it, i) => ({ ...it, index: i + 1 })));
                      saveDraft();
                    }}
                    style={{ padding: '8px 10px' }}
                  >削除</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (guards.length >= 8) return;
                  setGuards([...guards, { index: guards.length + 1, name: '', start_time: '', end_time: '', early_overtime_hours: null }]);
                }}
                style={{ marginTop: '8px' }}
              >+ 警備員を追加</button>
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
            {hasQualifier && (
              <div style={{ marginTop: '8px' }}>
                <select
                  style={styles.input}
                  value={qualifierName}
                  onChange={(e) => { setQualifierName(e.target.value); setTimeout(saveDraft, 0); }}
                >
                  <option value="">-- 資格者を選択 --</option>
                  {guards.filter(g => g.name.trim() !== '').map((g, idx) => (
                    <option key={idx} value={g.name}>{g.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  style={{ ...styles.input, marginTop: '8px' }}
                  value={qualifierName}
                  onChange={(e) => setQualifierName(e.target.value)}
                  onBlur={saveDraft}
                  placeholder="上記にない場合は直接入力"
                />
              </div>
            )}
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
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && isFormValid && !submitting) handleSubmit() }}
            disabled={!isFormValid || submitting}
          >
            {submitting ? '送信中...' : '報告書を送信'}
          </button>
          {!isFormValid && (
            <p style={styles.submitHint}>
              監督者名、警備内容（1つ以上）、署名を入力してください
            </p>
          )}
          {errorMessage && (
            <p style={styles.submitError}>
              {errorMessage}
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
    padding: '16px'
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
    padding: '16px',
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
    padding: '14px 12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    boxSizing: 'border-box',
    WebkitAppearance: 'none'
  },
  radioGroup: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '15px'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '15px',
    cursor: 'pointer',
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    backgroundColor: '#fafafa'
  },
  radio: {
    width: '20px',
    height: '20px'
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '15px',
    cursor: 'pointer',
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    backgroundColor: '#fafafa'
  },
  checkbox: {
    width: '22px',
    height: '22px'
  },
  numberInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  numberInput: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box',
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
  submitError: {
    textAlign: 'center',
    fontSize: '14px',
    color: '#c00',
    marginTop: '10px',
    backgroundColor: '#fee',
    padding: '10px',
    borderRadius: '4px'
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
  },
  inputReadonly: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box',
    backgroundColor: '#f5f5f5',
    color: '#666'
  },
  emailRegistrationBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    maxWidth: '400px',
    width: '100%'
  },
  emailRegistrationTitle: {
    margin: '0 0 15px',
    fontSize: '20px',
    color: '#333',
    textAlign: 'center'
  },
  emailRegistrationDesc: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
    lineHeight: 1.6
  },
  emailProjectInfo: {
    backgroundColor: '#f5f5f5',
    padding: '15px',
    borderRadius: '4px',
    marginBottom: '20px',
    fontSize: '14px'
  },
  emailInputGroup: {
    marginBottom: '20px'
  },
  emailInput: {
    width: '100%',
    padding: '14px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box'
  },
  emailErrorText: {
    color: '#c00',
    fontSize: '13px',
    marginTop: '8px'
  },
  emailButton: {
    width: '100%',
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    padding: '16px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  emailButtonDisabled: {
    width: '100%',
    backgroundColor: '#ccc',
    color: '#666',
    border: 'none',
    padding: '16px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'not-allowed'
  },
  nameSelectionBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    maxWidth: '450px',
    width: '100%'
  },
  nameSelectionTitle: {
    margin: '0 0 15px',
    fontSize: '20px',
    color: '#333',
    textAlign: 'center'
  },
  nameSelectionDesc: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
    lineHeight: 1.6,
    textAlign: 'center'
  },
  nameSearchInputGroup: {
    marginBottom: '20px'
  },
  nameSearchInput: {
    width: '100%',
    padding: '14px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box'
  },
  searchingText: {
    fontSize: '13px',
    color: '#666',
    marginTop: '8px',
    textAlign: 'center'
  },
  nameSearchResults: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  nameResultItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '14px 16px',
    backgroundColor: '#f9f9f9',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%'
  },
  nameKanji: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333'
  },
  nameKana: {
    fontSize: '14px',
    color: '#666',
    marginLeft: '8px'
  },
  noResultsText: {
    fontSize: '14px',
    color: '#999',
    textAlign: 'center',
    marginTop: '20px'
  },
  nameConfirmationBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center'
  },
  nameConfirmationTitle: {
    margin: '0 0 20px',
    fontSize: '20px',
    color: '#333'
  },
  nameConfirmationQuestion: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '30px',
    lineHeight: 1.6
  },
  confirmationButtons: {
    display: 'flex',
    gap: '15px',
    justifyContent: 'center'
  },
  confirmYesButton: {
    flex: 1,
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    padding: '14px 24px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  confirmNoButton: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    color: '#333',
    border: '1px solid #ddd',
    padding: '14px 24px',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  registeredNameBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    border: '1px solid #ddd'
  },
  registeredName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333'
  },
  changeRegistrationButton: {
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #999',
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer'
  },
  multiCastBadge: {
    display: 'inline-block',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'normal',
    marginLeft: '8px'
  },
  inputDbLinked: {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #90caf9',
    borderRadius: '4px',
    boxSizing: 'border-box',
    backgroundColor: '#e3f2fd',
    color: '#333',
    WebkitAppearance: 'none'
  }
}

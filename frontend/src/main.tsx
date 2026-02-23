import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import FieldReport from './pages/FieldReport'
import CastRegister from './pages/CastRegister'
import CastVerify from './pages/CastVerify'
import CastLogin from './pages/CastLogin'
import CastToday from './pages/CastToday'
import CastMagic from './pages/CastMagic'
import CastResetPin from './pages/CastResetPin'
import CastInquiry from './pages/CastInquiry'
import './index.css'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || '',
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
  release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={
      <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>エラーが発生しました</h1>
        <p>予期しないエラーが発生しました。ページを再読み込みしてください。</p>
        <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
          再読み込み
        </button>
      </div>
    }>
      <BrowserRouter>
        <Routes>
          <Route path="/report/:uniqueUrl" element={<FieldReport />} />
          <Route path="/cast/register" element={<CastRegister />} />
          <Route path="/cast/verify" element={<CastVerify />} />
          <Route path="/cast/login" element={<CastLogin />} />
          <Route path="/cast/today" element={<CastToday />} />
          <Route path="/cast/magic" element={<CastMagic />} />
          <Route path="/cast/reset-pin" element={<CastResetPin />} />
          <Route path="/cast/inquiry" element={<CastInquiry />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
)

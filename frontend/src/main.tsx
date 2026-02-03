import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import FieldReport from './pages/FieldReport'
import CastRegister from './pages/CastRegister'
import CastVerify from './pages/CastVerify'
import CastLogin from './pages/CastLogin'
import CastToday from './pages/CastToday'
import CastMagic from './pages/CastMagic'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/report/:uniqueUrl" element={<FieldReport />} />
        <Route path="/cast/register" element={<CastRegister />} />
        <Route path="/cast/verify" element={<CastVerify />} />
        <Route path="/cast/login" element={<CastLogin />} />
        <Route path="/cast/today" element={<CastToday />} />
        <Route path="/cast/magic" element={<CastMagic />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function RootRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    const redirect = async () => {
      const castToken = localStorage.getItem('castToken')
      if (castToken) {
        navigate('/cast/today', { replace: true })
        return
      }

      try {
        const resp = await fetch('/api/admin/me', { credentials: 'include' })
        if (resp.ok) {
          navigate('/admin', { replace: true })
          return
        }
      } catch {}

      navigate('/cast/login', { replace: true })
    }

    redirect()
  }, [navigate])

  return null
}

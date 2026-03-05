import { useRef, useEffect, useState, useCallback } from 'react'

interface SignatureModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (signatureDataUrl: string) => void
}

export default function SignatureModal({ isOpen, onClose, onSave }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const syncCanvasSize = useCallback((preserveContent = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    let prevData: ImageData | null = null
    if (preserveContent && canvas.width > 0 && canvas.height > 0) {
      prevData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    }

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, rect.width, rect.height)

    if (prevData) {
      ctx.putImageData(prevData, 0, 0)
    }

    ctx.strokeStyle = '#000'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  useEffect(() => {
    if (isOpen) {
      setHasDrawn(false)

      const scrollY = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${scrollY}px`

      const raf = requestAnimationFrame(() => syncCanvasSize(false))
      return () => cancelAnimationFrame(raf)
    } else {
      const top = document.body.style.top
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      if (top) window.scrollTo(0, parseInt(top, 10) * -1)
    }
  }, [isOpen, syncCanvasSize])

  useEffect(() => {
    if (!isOpen) return
    const onResize = () => syncCanvasSize(true)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [isOpen, syncCanvasSize])

  const getCoordinates = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      }
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top
    }
  }

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    setIsDrawing(true)
    const { x, y } = getCoordinates(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    if (!isDrawing) return

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    const { x, y } = getCoordinates(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasDrawn(true)
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    setHasDrawn(false)
  }

  const handleSave = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn) return

    const dataUrl = canvas.toDataURL('image/png')
    onSave(dataUrl)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      style={styles.overlay}
      onTouchMove={(e) => {
        if (!(e.target instanceof HTMLCanvasElement)) e.preventDefault()
      }}
    >
      <div style={styles.header}>
        <button style={styles.cancelButton} onClick={onClose}>
          キャンセル
        </button>
        <span style={styles.title}>署名してください</span>
        <button style={styles.clearButton} onClick={handleClear}>
          クリア
        </button>
      </div>
      
      <canvas
        ref={canvasRef}
        style={styles.canvas}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      
      <div style={styles.footer}>
        <button 
          style={hasDrawn ? styles.saveButton : styles.saveButtonDisabled}
          onClick={handleSave}
          disabled={!hasDrawn}
        >
          署名を確定
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#f5f5f5',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    overscrollBehavior: 'none' as const,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px 20px',
    paddingTop: 'calc(15px + env(safe-area-inset-top, 0px))',
    backgroundColor: '#333',
    color: 'white',
    flexShrink: 0,
  },
  title: {
    fontSize: '18px',
    fontWeight: 'bold'
  },
  cancelButton: {
    backgroundColor: 'transparent',
    color: 'white',
    border: '1px solid white',
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  clearButton: {
    backgroundColor: '#ff6b6b',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  canvas: {
    flex: 1,
    touchAction: 'none',
    cursor: 'crosshair',
    display: 'block',
  },
  footer: {
    padding: '15px 20px',
    paddingBottom: 'calc(15px + env(safe-area-inset-bottom, 0px))',
    backgroundColor: 'white',
    borderTop: '1px solid #ddd',
    flexShrink: 0,
  },
  saveButton: {
    width: '100%',
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    padding: '15px',
    borderRadius: '8px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  saveButtonDisabled: {
    width: '100%',
    backgroundColor: '#ccc',
    color: '#666',
    border: 'none',
    padding: '15px',
    borderRadius: '8px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'not-allowed'
  }
}

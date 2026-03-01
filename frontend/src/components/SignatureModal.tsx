import { useRef, useEffect, useState } from 'react'

interface SignatureModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (signatureDataUrl: string) => void
}

export default function SignatureModal({ isOpen, onClose, onSave }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    if (isOpen && canvasRef.current) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (ctx) {
        canvas.width = window.innerWidth
        const safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0', 10)
        canvas.height = window.innerHeight - 120 - safeBottom
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
      }
      setHasDrawn(false)
    }
  }, [isOpen])

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

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
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
    <div style={styles.overlay}>
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
    flexDirection: 'column'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px 20px',
    backgroundColor: '#333',
    color: 'white'
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
    cursor: 'crosshair'
  },
  footer: {
    padding: '15px 20px',
    paddingBottom: 'calc(15px + env(safe-area-inset-bottom, 0px))',
    backgroundColor: 'white',
    borderTop: '1px solid #ddd'
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

import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL

export default function Landing() {
  const [backendStatus, setBackendStatus] = useState('checking…')

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then(r => r.json())
      .then(data => setBackendStatus(data.status))
      .catch(() => setBackendStatus('unreachable'))
  }, [])

  const statusColor = backendStatus === 'healthy' ? '#4ade80' : '#f87171'

  return (
    <div>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Foresight</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Adversarial AI red-teaming for strategic decisions.
      </p>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
        background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '0.5rem' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%',
          background: statusColor, display: 'inline-block' }} />
        <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
          Backend: <strong style={{ color: statusColor }}>{backendStatus}</strong>
        </span>
      </div>
    </div>
  )
}

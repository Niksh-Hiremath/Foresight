import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const VERDICT_CONFIG = {
  DO_NOT_PROCEED:       { label: 'DO NOT PROCEED',       color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  PROCEED_WITH_CAUTION: { label: 'PROCEED WITH CAUTION', color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
  PROCEED:              { label: 'PROCEED',               color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
}

function loadLocalSessions() {
  try {
    return JSON.parse(localStorage.getItem('foresight_sessions') || '[]')
  } catch {
    return []
  }
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const local = loadLocalSessions()

    const enrich = async () => {
      setLoading(true)
      const enriched = await Promise.all(
        local.map(async s => {
          try {
            const r = await fetch(`${API}/agents/score/${s.id}`)
            if (r.ok) {
              const d = await r.json()
              return { ...s, verdict: d.verdict, score: d.risk_score, counts: d.counts }
            }
          } catch {}
          return s
        })
      )
      setSessions(enriched)
      setLoading(false)
    }

    if (local.length > 0) {
      enrich()
    } else {
      setLoading(false)
    }
  }, [])

  const openSession = (id) => navigate(`/agents?decision_id=${id}`)

  const deleteSession = (id) => {
    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated)
    localStorage.setItem('foresight_sessions', JSON.stringify(updated))
    localStorage.removeItem(`foresight_events_${id}`)
  }

  const clearHistory = () => {
    sessions.forEach(s => localStorage.removeItem(`foresight_events_${s.id}`))
    localStorage.removeItem('foresight_sessions')
    setSessions([])
  }

  return (
    <div className="bg-grid text-on-surface relative min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="fixed inset-0 pointer-events-none bg-grid-pattern opacity-40 z-0" />
      <Sidebar />

      <main className="ml-64 pt-16 min-h-screen p-6 md:p-10 flex flex-col gap-8 relative z-10">
        {/* Header */}
        <div className="flex justify-between items-end border-b border-outline-variant pb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="w-2 h-2 bg-primary-container rounded-full animate-pulse" />
              <span className="text-[11px] text-primary-container uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                Session Archive
              </span>
            </div>
            <h1 className="font-bold text-on-surface uppercase tracking-tighter" style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem' }}>
              ANALYSIS <span className="text-primary-container">HISTORY</span>
            </h1>
            <p className="text-[11px] text-on-surface-variant uppercase tracking-widest mt-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {sessions.length} SESSION{sessions.length !== 1 ? 'S' : ''} STORED LOCALLY
            </p>
          </div>
          {sessions.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-[11px] text-on-surface-variant hover:text-primary-container px-4 py-2 border border-outline-variant hover:border-primary-container/50 rounded transition-all uppercase flex items-center gap-2"
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            >
              <span className="material-symbols-outlined text-sm">delete_sweep</span>
              CLEAR ALL
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center gap-4 text-on-surface-variant py-20 justify-center">
            <div className="thinking-dots"><span /><span /><span /></div>
            <span className="text-[11px] uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              LOADING SESSIONS…
            </span>
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <SessionTable sessions={sessions} onOpen={openSession} onDelete={deleteSession} />
        )}
      </main>
    </div>
  )
}

function EmptyState() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-6">
      <div className="w-20 h-20 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant">history</span>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-on-surface uppercase tracking-tight mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
          No Sessions Found
        </h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Analysis sessions will appear here once you run the Foresight pipeline.
        </p>
        <button
          onClick={() => navigate('/agents')}
          className="bg-primary-container text-on-primary-container px-8 py-3 rounded uppercase tracking-widest text-[11px] hover:bg-primary transition-colors"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          START NEW ANALYSIS →
        </button>
      </div>
    </div>
  )
}

function SessionTable({ sessions, onOpen, onDelete }) {
  return (
    <section className="bg-surface-container border border-outline-variant flex flex-col">
      {/* Column headers */}
      <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-outline-variant bg-surface-container-low text-[11px] text-on-surface-variant uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        <div className="col-span-4">SESSION / DOCUMENT</div>
        <div className="col-span-2">DATE</div>
        <div className="col-span-3">VERDICT</div>
        <div className="col-span-2">RISK SCORE</div>
        <div className="col-span-1 text-right">ACTIONS</div>
      </div>

      <div className="flex flex-col overflow-y-auto">
        {[...sessions].reverse().map((s, idx) => {
          const vc = VERDICT_CONFIG[s.verdict]
          return (
            <div
              key={idx}
              onClick={() => onOpen(s.id)}
              className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-outline-variant/30 data-row items-center border-l-2 border-transparent cursor-pointer"
            >
              {/* Session info */}
              <div className="col-span-4 flex flex-col gap-1">
                <div className="text-[11px] text-on-surface flex items-center gap-2 truncate" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  <span className="material-symbols-outlined text-on-surface-variant text-base">description</span>
                  <span className="truncate">{s.filename || 'Unnamed session'}</span>
                </div>
                <div className="text-[10px] text-on-surface-variant/60 pl-6 truncate" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {s.id?.slice(0, 16)}…
                </div>
              </div>

              {/* Date */}
              <div className="col-span-2 text-[11px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {s.timestamp ? new Date(s.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
              </div>

              {/* Verdict */}
              <div className="col-span-3">
                {vc ? (
                  <span
                    className="text-[10px] px-2 py-1 rounded uppercase tracking-widest border"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: vc.color, background: vc.bg, borderColor: `${vc.color}33` }}
                  >
                    {vc.label}
                  </span>
                ) : (
                  <span className="text-[11px] text-on-surface-variant/50" style={{ fontFamily: 'JetBrains Mono, monospace' }}>—</span>
                )}
              </div>

              {/* Score */}
              <div className="col-span-2">
                {s.score != null ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-surface-container-highest rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.score}%`,
                          backgroundColor: s.score >= 80 ? '#ef4444' : s.score >= 50 ? '#f97316' : '#22c55e',
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-on-surface" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{s.score}</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-on-surface-variant/50" style={{ fontFamily: 'JetBrains Mono, monospace' }}>—</span>
                )}
              </div>

              {/* Actions */}
              <div className="col-span-1 flex items-center justify-end gap-2">
                <button
                  onClick={e => { e.stopPropagation(); onOpen(s.id) }}
                  className="text-on-surface-variant hover:text-primary-container transition-colors"
                  title="Open"
                >
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                  className="text-on-surface-variant hover:text-error transition-colors"
                  title="Delete"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

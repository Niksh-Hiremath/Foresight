import { useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import './Dashboard.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const AGENT_LABELS = {
  cfo: 'CFO Agent',
  market: 'Market Agent',
  competitor: 'Competitor Agent',
  legal: 'Legal Agent',
  execution: 'Execution Agent',
}

const AGENT_ICONS = {
  cfo: '💰',
  market: '📈',
  competitor: '⚔️',
  legal: '⚖️',
  execution: '🚀',
}

const SEV_CONFIG = {
  CRITICAL: { label: 'CRITICAL', cls: 'sev-critical' },
  HIGH: { label: 'HIGH', cls: 'sev-high' },
  MEDIUM: { label: 'MEDIUM', cls: 'sev-medium' },
}

const ALL_AGENTS = ['cfo', 'market', 'competitor', 'legal', 'execution']

function initAgents() {
  return Object.fromEntries(ALL_AGENTS.map(a => [a, { status: 'waiting', findings: [] }]))
}

export default function Dashboard() {
  const [searchParams] = useSearchParams()
  const initialId = searchParams.get('decision_id') || ''
  const [decisionId, setDecisionId] = useState(initialId)
  const [inputId, setInputId] = useState(initialId)
  const [agents, setAgents] = useState(initAgents)
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [runError, setRunError] = useState('')
  const abortRef = useRef(null)

  const updateAgent = useCallback((name, patch) => {
    setAgents(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }, [])

  const runAnalysis = useCallback(async () => {
    const id = decisionId.trim()
    if (!id) return

    // Reset
    setAgents(initAgents())
    setProgress(0)
    setRunning(true)
    setDone(false)
    setRunError('')

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch(`${API}/agents/run-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: id }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`${res.status}: ${txt}`)
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          try {
            const ev = JSON.parse(raw)
            handleEvent(ev)
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setRunError(err.message)
      }
    } finally {
      setRunning(false)
    }

    function handleEvent(ev) {
      if (ev.event === 'agent_start') {
        updateAgent(ev.agent, { status: 'thinking' })
      } else if (ev.event === 'agent_complete') {
        updateAgent(ev.agent, { status: 'complete', findings: ev.findings || [] })
        setProgress(ev.progress || 0)
      } else if (ev.event === 'agent_error') {
        updateAgent(ev.agent, { status: 'error', errorMsg: ev.error || 'Unknown error' })
      } else if (ev.event === 'complete') {
        setProgress(100)
        setDone(true)
      }
    }
  }, [decisionId, updateAgent])

  const cancelRun = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  const totalFindings = ALL_AGENTS.reduce((s, a) => s + (agents[a].findings?.length || 0), 0)
  const criticalCount = ALL_AGENTS.flatMap(a => agents[a].findings || [])
    .filter(f => f.severity === 'CRITICAL').length

  return (
    <div className="dashboard-page">
      {/* ── Header ── */}
      <div className="dash-header">
        <div className="dash-title-row">
          <h1>Red Team Analysis</h1>
          {done && (
            <span className="findings-summary">
              {totalFindings} findings · <span className="crit-badge">{criticalCount} critical</span>
            </span>
          )}
        </div>

        <div className="dash-controls">
          {!decisionId ? (
            <div className="id-input-row">
              <input
                className="id-input"
                placeholder="Paste decision_id from Upload step…"
                value={inputId}
                onChange={e => setInputId(e.target.value)}
              />
              <button
                className="btn-primary"
                disabled={!inputId.trim()}
                onClick={() => setDecisionId(inputId.trim())}
              >
                Set ID
              </button>
            </div>
          ) : (
            <div className="run-row">
              <span className="id-pill">decision: {decisionId}</span>
              {running ? (
                <>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="progress-label">{progress}%</span>
                  <button className="btn-secondary" onClick={cancelRun}>Cancel</button>
                </>
              ) : (
                <button className="btn-primary" onClick={runAnalysis}>
                  {done ? 'Re-run Analysis' : 'Run Red Team Analysis →'}
                </button>
              )}
              <button className="btn-ghost" onClick={() => { setDecisionId(''); setInputId(''); setAgents(initAgents()); setDone(false); setProgress(0) }}>
                Change ID
              </button>
            </div>
          )}
        </div>

        {runError && <p className="run-error">{runError}</p>}
      </div>

      {/* ── Agent Grid ── */}
      {decisionId && (
        <div className="agent-grid">
          {ALL_AGENTS.map(name => (
            <AgentCard
              key={name}
              name={name}
              state={agents[name]}
            />
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!decisionId && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <h2>No analysis loaded</h2>
          <p>Enter a decision ID above, or go to the <a href="/upload">Upload page</a> to start a new analysis.</p>
        </div>
      )}
    </div>
  )
}

function AgentCard({ name, state }) {
  const { status, findings = [], errorMsg } = state

  return (
    <div className={`agent-card agent-card--${status}`}>
      <div className="agent-card-header">
        <span className="agent-icon">{AGENT_ICONS[name]}</span>
        <span className="agent-name">{AGENT_LABELS[name]}</span>
        <StatusChip status={status} />
      </div>

      {status === 'thinking' && (
        <div className="agent-thinking">
          <div className="thinking-dots">
            <span /><span /><span />
          </div>
          <p>Analyzing decision context…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="agent-error-body">
          <p>{errorMsg}</p>
        </div>
      )}

      {status === 'complete' && findings.length === 0 && (
        <p className="agent-empty">No findings.</p>
      )}

      {status === 'complete' && findings.length > 0 && (
        <div className="findings-list">
          {findings.map(f => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function StatusChip({ status }) {
  const labels = { waiting: 'Waiting', thinking: 'Analyzing…', complete: 'Done', error: 'Error' }
  return <span className={`status-chip status-${status}`}>{labels[status] || status}</span>
}

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(false)
  const sev = SEV_CONFIG[finding.severity] || SEV_CONFIG.MEDIUM
  const hasSources = finding.sources?.length > 0

  return (
    <div className="finding-row">
      <div className="finding-header" onClick={() => setExpanded(e => !e)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}>
        <span className={`sev-badge ${sev.cls}`}>{sev.label}</span>
        <span className="finding-title">{finding.vulnerability}</span>
        <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="finding-body">
          <div className="finding-section">
            <p className="finding-section-label">Attack Vector</p>
            <p className="finding-section-text">{finding.attack}</p>
          </div>
          <div className="finding-section">
            <p className="finding-section-label">Investor Question</p>
            <p className="finding-section-text finding-question">{finding.question}</p>
          </div>
          {hasSources && (
            <div className="finding-sources">
              <p className="finding-section-label">Sources</p>
              <ul>
                {finding.sources.map((src, i) => (
                  <li key={i}>
                    {src.startsWith('http') ? (
                      <a href={src} target="_blank" rel="noopener noreferrer">{src}</a>
                    ) : (
                      <span>{src}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

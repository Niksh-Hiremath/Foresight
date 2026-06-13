import { useState, useCallback, useRef, useEffect } from 'react'
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

const STAGE_LABELS = {
  agents: 'Running adversarial agents…',
  scoring: 'Computing risk score…',
  simulating: 'Running scenario simulation…',
  synthesizing: 'Generating verdict & strategy…',
}

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
  const [scoreData, setScoreData] = useState(null)
  const [synthesisData, setSynthesisData] = useState(null)
  const [pipelineStage, setPipelineStage] = useState(null)
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
    setScoreData(null)
    setSynthesisData(null)
    setPipelineStage('agents')

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch(`${API}/analyze`, {
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
      setPipelineStage(null)
    }

    function handleEvent(ev) {
      if (ev.event === 'agent_start') {
        updateAgent(ev.agent, { status: 'thinking' })
        setPipelineStage('agents')
      } else if (ev.event === 'agent_complete') {
        updateAgent(ev.agent, { status: 'complete', findings: ev.findings || [] })
        setProgress(ev.progress || 0)
      } else if (ev.event === 'agent_error') {
        updateAgent(ev.agent, { status: 'error', errorMsg: ev.error || 'Unknown error' })
      } else if (ev.event === 'scoring') {
        setPipelineStage('scoring')
        setProgress(ev.progress || 90)
        setScoreData(ev)
      } else if (ev.event === 'simulating') {
        setPipelineStage('simulating')
        setProgress(ev.progress || 93)
      } else if (ev.event === 'synthesizing') {
        setPipelineStage('synthesizing')
        setProgress(ev.progress || 96)
      } else if (ev.event === 'complete') {
        setProgress(100)
        setDone(true)
        if (ev.score) setScoreData(ev.score)
        if (ev.report) setSynthesisData(ev.report)
      }
    }
  }, [decisionId, updateAgent])

  // Load persisted results on page load
  useEffect(() => {
    if (!decisionId) return
    fetch(`${API}/agents/score/${decisionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setScoreData(data); setDone(true) } })
      .catch(() => {})
    fetch(`${API}/synthesize/${decisionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setSynthesisData(data) })
      .catch(() => {})
  }, [decisionId])

  const cancelRun = () => {
    abortRef.current?.abort()
    setRunning(false)
    setPipelineStage(null)
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
              <button className="btn-ghost" onClick={() => {
                setDecisionId(''); setInputId('')
                setAgents(initAgents()); setDone(false)
                setProgress(0); setScoreData(null); setSynthesisData(null)
              }}>
                Change ID
              </button>
            </div>
          )}
        </div>

        {/* Pipeline stage indicator */}
        {running && pipelineStage && (
          <div className="pipeline-stage">
            <div className="thinking-dots"><span /><span /><span /></div>
            <span>{STAGE_LABELS[pipelineStage] || 'Processing…'}</span>
          </div>
        )}

        {runError && <p className="run-error">{runError}</p>}
      </div>

      {/* ── Risk Score Card ── */}
      {scoreData && <RiskScoreCard data={scoreData} />}

      {/* ── Synthesis Card ── */}
      {synthesisData && <SynthesisCard data={synthesisData} />}

      {/* ── Agent Grid ── */}
      {decisionId && (
        <div className="agent-grid">
          {ALL_AGENTS.map(name => (
            <AgentCard key={name} name={name} state={agents[name]} />
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

/* ── Verdict config ─────────────────────────────────────────────────── */

const VERDICT_CONFIG = {
  DO_NOT_PROCEED: { cls: 'verdict-stop', icon: '🚫', label: 'DO NOT PROCEED' },
  PROCEED_WITH_CAUTION: { cls: 'verdict-caution', icon: '⚠️', label: 'PROCEED WITH CAUTION' },
  PROCEED: { cls: 'verdict-go', icon: '✅', label: 'PROCEED' },
}

/* ── Risk Score Card ─────────────────────────────────────────────────── */

function RiskScoreCard({ data }) {
  const vc = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION
  const pct = data.risk_score

  return (
    <div className={`risk-score-card ${vc.cls}`}>
      <div className="risk-left">
        <div className="risk-gauge">
          <svg viewBox="0 0 120 70" className="gauge-svg">
            <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
            <path
              d="M10,60 A50,50 0 0,1 110,60"
              fill="none"
              stroke={pct >= 80 ? '#ef4444' : pct >= 50 ? '#f97316' : '#22c55e'}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 157} 157`}
            />
            <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="#f1f5f9">{pct}</text>
            <text x="60" y="70" textAnchor="middle" fontSize="7" fill="#64748b">/100</text>
          </svg>
        </div>
        <div className="risk-meta">
          <span className="risk-score-num">{pct}</span>
          <span className="risk-score-label">Risk Score</span>
        </div>
      </div>

      <div className="risk-center">
        <div className={`verdict-banner ${vc.cls}`}>
          <span className="verdict-icon">{vc.icon}</span>
          <span className="verdict-text">{vc.label}</span>
        </div>
        <div className="risk-breakdown">
          <span className="rb-item rb-critical">{data.counts?.CRITICAL ?? 0} critical</span>
          <span className="rb-sep">·</span>
          <span className="rb-item rb-high">{data.counts?.HIGH ?? 0} high</span>
          <span className="rb-sep">·</span>
          <span className="rb-item rb-medium">{data.counts?.MEDIUM ?? 0} medium</span>
        </div>
      </div>

      <div className="risk-right">
        <div className="score-row"><span className="score-row-label">Base score</span><span>{data.base_score}</span></div>
        {data.bonus_critical_convergence > 0 && (
          <div className="score-row score-bonus"><span className="score-row-label">Cross-agent CRITICAL</span><span>+{data.bonus_critical_convergence}</span></div>
        )}
        {data.bonus_high_convergence > 0 && (
          <div className="score-row score-bonus"><span className="score-row-label">Cross-agent HIGH</span><span>+{data.bonus_high_convergence}</span></div>
        )}
        <div className="score-row score-total"><span className="score-row-label">Total (capped 100)</span><span>{pct}</span></div>
      </div>
    </div>
  )
}

/* ── Synthesis Card ──────────────────────────────────────────────────── */

function SynthesisCard({ data }) {
  const [gtmOpen, setGtmOpen] = useState(false)
  const [simOpen, setSimOpen] = useState(false)
  const hasSim = data.bull || data.base || data.bear

  return (
    <div className="synthesis-card">
      {/* Executive Summary */}
      <div className="synth-section">
        <h3 className="synth-heading">Executive Summary</h3>
        <p className="synth-body">{data.executive_summary}</p>
      </div>

      {/* Key Questions */}
      {data.key_questions?.length > 0 && (
        <div className="synth-section">
          <h3 className="synth-heading">3 Questions to Ask Before Signing</h3>
          <ol className="synth-questions">
            {data.key_questions.map((q, i) => (
              <li key={i} className="synth-question-item">{q}</li>
            ))}
          </ol>
        </div>
      )}

      {/* GTM Strategy — collapsible */}
      {data.gtm_strategy && (
        <div className="synth-section">
          <button className="synth-collapse-btn" onClick={() => setGtmOpen(o => !o)}>
            <span>India GTM Strategy</span>
            <span className="expand-icon">{gtmOpen ? '▲' : '▼'}</span>
          </button>
          {gtmOpen && (
            <div className="synth-gtm">
              {data.gtm_strategy.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Simulation scenarios — collapsible */}
      {hasSim && (
        <div className="synth-section">
          <button className="synth-collapse-btn" onClick={() => setSimOpen(o => !o)}>
            <span>Scenario Simulation</span>
            <span className="expand-icon">{simOpen ? '▲' : '▼'}</span>
          </button>
          {simOpen && (
            <div className="sim-bands">
              {data.bull && <ScenarioBand label="Bull" cls="band-bull" text={data.bull} />}
              {data.base && <ScenarioBand label="Base" cls="band-base" text={data.base} />}
              {data.bear && <ScenarioBand label="Bear" cls="band-bear" text={data.bear} />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScenarioBand({ label, cls, text }) {
  return (
    <div className={`scenario-band ${cls}`}>
      <span className="band-label">{label}</span>
      <p className="band-text">{text}</p>
    </div>
  )
}

/* ── Agent Card ──────────────────────────────────────────────────────── */

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
          <div className="thinking-dots"><span /><span /><span /></div>
          <p>Analyzing decision context…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="agent-error-body"><p>{errorMsg}</p></div>
      )}

      {status === 'complete' && findings.length === 0 && (
        <p className="agent-empty">No findings.</p>
      )}

      {status === 'complete' && findings.length > 0 && (
        <div className="findings-list">
          {findings.map(f => <FindingRow key={f.id} finding={f} />)}
        </div>
      )}
    </div>
  )
}

function StatusChip({ status }) {
  const labels = { waiting: 'Waiting', thinking: 'Analyzing…', complete: 'Done', error: 'Error' }
  return <span className={`status-chip status-${status}`}>{labels[status] || status}</span>
}

/* ── Finding Row ─────────────────────────────────────────────────────── */

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(false)
  const sev = SEV_CONFIG[finding.severity] || SEV_CONFIG.MEDIUM
  const hasSources = finding.sources?.length > 0

  return (
    <div className="finding-row">
      <div className="finding-header" onClick={() => setExpanded(e => !e)}
        role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}>
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
                    {src.startsWith('http')
                      ? <a href={src} target="_blank" rel="noopener noreferrer">{src}</a>
                      : <span>{src}</span>}
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

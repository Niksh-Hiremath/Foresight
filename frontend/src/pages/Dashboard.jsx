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

const AGENT_ICONS = { cfo: '💰', market: '📈', competitor: '⚔️', legal: '⚖️', execution: '🚀' }

const SEV_CONFIG = {
  CRITICAL: { label: 'CRITICAL', cls: 'sev-critical' },
  HIGH:     { label: 'HIGH',     cls: 'sev-high' },
  MEDIUM:   { label: 'MEDIUM',   cls: 'sev-medium' },
}

const VERDICT_CONFIG = {
  DO_NOT_PROCEED:      { cls: 'verdict-stop',    icon: '🚫', label: 'DO NOT PROCEED' },
  PROCEED_WITH_CAUTION:{ cls: 'verdict-caution', icon: '⚠️', label: 'PROCEED WITH CAUTION' },
  PROCEED:             { cls: 'verdict-go',      icon: '✅', label: 'PROCEED' },
}

const AGENT_REMEDIATION = {
  cfo:        'Independent financial audit & metrics definition',
  market:     'Third-party market validation study',
  competitor: 'Competitive intelligence deep-dive',
  legal:      'Legal & compliance review (DPDP / sector-specific)',
  execution:  'Execution risk assessment & capability audit',
}

const ALL_AGENTS = ['cfo', 'market', 'competitor', 'legal', 'execution']

const STAGE_LABELS = {
  agents:      'Running adversarial agents…',
  scoring:     'Computing risk score…',
  simulating:  'Running scenario simulation…',
  synthesizing:'Generating verdict & strategy…',
}

function initAgents() {
  return Object.fromEntries(ALL_AGENTS.map(a => [a, { status: 'waiting', findings: [] }]))
}

/* ─────────────────────────────────────────────────────────────────────────
   Main Dashboard component
───────────────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const [searchParams] = useSearchParams()
  const initialId = searchParams.get('decision_id') || ''

  const [decisionId,   setDecisionId]   = useState(initialId)
  const [inputId,      setInputId]      = useState(initialId)
  const [agents,       setAgents]       = useState(initAgents)
  const [progress,     setProgress]     = useState(0)
  const [running,      setRunning]      = useState(false)
  const [done,         setDone]         = useState(false)
  const [runError,     setRunError]     = useState('')
  const [scoreData,     setScoreData]     = useState(null)
  const [synthesisData, setSynthesisData] = useState(null)
  const [intakeData,    setIntakeData]    = useState(null)
  const [pipelineStage, setPipelineStage] = useState(null)
  const [mirofishUrl,   setMirofishUrl]   = useState(null)
  const abortRef = useRef(null)

  const updateAgent = useCallback((name, patch) => {
    setAgents(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }, [])

  // ── Load persisted results on page load / decisionId change ──────────
  useEffect(() => {
    if (!decisionId) return

    fetch(`${API}/intake/context/${decisionId}`)
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setIntakeData(d) }).catch(() => {})

    fetch(`${API}/agents/score/${decisionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setScoreData(d); setDone(true) } }).catch(() => {})

    // Load per-agent findings so the Remediation Roadmap and agent cards populate
    fetch(`${API}/agents/findings/${decisionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.findings?.length) return
        const byAgent = {}
        for (const f of data.findings) {
          if (!byAgent[f.agent]) byAgent[f.agent] = []
          byAgent[f.agent].push(f)
        }
        setAgents(prev => {
          const next = { ...prev }
          for (const [agent, findings] of Object.entries(byAgent)) {
            if (next[agent]) next[agent] = { status: 'complete', findings }
          }
          return next
        })
      }).catch(() => {})

    // Merge synthesis + simulation for full narrative
    Promise.all([
      fetch(`${API}/synthesize/${decisionId}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/simulate/result/${decisionId}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([synth, sim]) => {
      if (synth || sim) {
        setSynthesisData({
          ...(synth || {}),
          bull: sim?.bull || synth?.bull,
          base: sim?.base || synth?.base,
          bear: sim?.bear || synth?.bear,
          opinion_dynamics: sim?.opinion_dynamics || synth?.opinion_dynamics,
        })
      }
    })
  }, [decisionId])

  // ── Run full pipeline via POST /analyze ──────────────────────────────
  const runAnalysis = useCallback(async () => {
    const id = decisionId.trim()
    if (!id) return

    setAgents(initAgents()); setProgress(0); setRunning(true)
    setDone(false); setRunError(''); setScoreData(null)
    setSynthesisData(null); setPipelineStage('agents'); setMirofishUrl(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch(`${API}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: id }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done: sd, value } = await reader.read()
        if (sd) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          try { handleEvent(JSON.parse(raw)) } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setRunError(err.message)
    } finally {
      setRunning(false); setPipelineStage(null)
    }

    function handleEvent(ev) {
      switch (ev.event) {
        case 'agent_start':
          updateAgent(ev.agent, { status: 'thinking' }); setPipelineStage('agents'); break
        case 'agent_complete':
          updateAgent(ev.agent, { status: 'complete', findings: ev.findings || [] })
          setProgress(ev.progress || 0); break
        case 'agent_error':
          updateAgent(ev.agent, { status: 'error', errorMsg: ev.error || 'Unknown error' }); break
        case 'scoring':
          setPipelineStage('scoring'); setProgress(ev.progress || 90); setScoreData(ev); break
        case 'simulating':
          setPipelineStage('simulating'); setProgress(ev.progress || 93); break
        case 'sim_started':
          if (ev.mirofish_url) {
            setMirofishUrl(ev.mirofish_url)
            window.open(ev.mirofish_url, '_blank', 'noopener,noreferrer')
          }
          break
        case 'synthesizing':
          setPipelineStage('synthesizing'); setProgress(ev.progress || 96); break
        case 'complete':
          setProgress(100); setDone(true)
          if (ev.score) setScoreData(ev.score)
          if (ev.report) setSynthesisData(ev.report)
          break
      }
    }
  }, [decisionId, updateAgent])

  const cancelRun = () => { abortRef.current?.abort(); setRunning(false); setPipelineStage(null) }

  const resetAll = () => {
    setDecisionId(''); setInputId(''); setAgents(initAgents())
    setDone(false); setProgress(0); setScoreData(null)
    setSynthesisData(null); setIntakeData(null)
  }

  const agentTotal = ALL_AGENTS.reduce((s, a) => s + (agents[a].findings?.length || 0), 0)
  const totalFindings = scoreData?.total_findings ?? agentTotal
  const criticalCount = scoreData?.counts?.CRITICAL ??
    ALL_AGENTS.flatMap(a => agents[a].findings || []).filter(f => f.severity === 'CRITICAL').length

  return (
    <div className="dashboard-page">

      {/* ── Controls ─────────────────────────────────────────────────── */}
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
              <input className="id-input" placeholder="Paste decision_id from Upload step…"
                value={inputId} onChange={e => setInputId(e.target.value)} />
              <button className="btn-primary" disabled={!inputId.trim()}
                onClick={() => setDecisionId(inputId.trim())}>Set ID</button>
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
              <button className="btn-ghost" onClick={resetAll}>Change ID</button>
            </div>
          )}
        </div>

        {running && pipelineStage && (
          <div className="pipeline-stage">
            <div className="thinking-dots"><span /><span /><span /></div>
            <span>{STAGE_LABELS[pipelineStage] || 'Processing…'}</span>
          </div>
        )}
        {runError && <p className="run-error">{runError}</p>}
      </div>

      {/* ── MiroFish Live View — opens in new tab when sim_id available ── */}
      {mirofishUrl && (
        <div className="mirofish-banner">
          <span className="mirofish-dot" />
          <span className="mirofish-banner-text">MiroFish simulation is live</span>
          <a href={mirofishUrl} target="_blank" rel="noreferrer" className="mirofish-banner-link">
            Open live view ↗
          </a>
        </div>
      )}

      {/* ── Prominent Verdict Banner ──────────────────────────────────── */}
      {scoreData && <VerdictBannerHero data={scoreData} />}

      {/* ── 01 Decision Context ──────────────────────────────────────── */}
      {intakeData && (
        <DashSection num="01" title="Decision Context">
          <IntakeSummary data={intakeData} />
        </DashSection>
      )}

      {/* ── 02 Agent Analysis ─────────────────────────────────────────── */}
      {decisionId && (
        <DashSection num="02" title="Agent Analysis">
          <div className="agent-grid">
            {ALL_AGENTS.map(name => (
              <AgentCard key={name} name={name} state={agents[name]} />
            ))}
          </div>
        </DashSection>
      )}

      {/* ── 03 Risk Assessment ────────────────────────────────────────── */}
      {scoreData && (
        <DashSection num="03" title="Risk Assessment">
          <RiskScoreCard data={scoreData} />
          {synthesisData?.executive_summary && (
            <div className="exec-summary-block">
              <p className="field-label">Executive Summary</p>
              <p className="exec-summary-text">{synthesisData.executive_summary}</p>
            </div>
          )}
          {synthesisData?.key_questions?.length > 0 && (
            <div className="questions-block">
              <p className="field-label">3 Questions to Ask Before Signing</p>
              <ol className="questions-list">
                {synthesisData.key_questions.map((q, i) => (
                  <li key={i} className="question-item">{q}</li>
                ))}
              </ol>
            </div>
          )}
        </DashSection>
      )}

      {/* ── 04 Remediation Roadmap ────────────────────────────────────── */}
      {done && scoreData && (
        <DashSection num="04" title="Remediation Roadmap">
          <RemediationRoadmap agents={agents} verdict={scoreData.verdict} />
        </DashSection>
      )}

      {/* ── 05 Future Scenarios ───────────────────────────────────────── */}
      {(synthesisData?.bull || synthesisData?.base || synthesisData?.bear) && (
        <DashSection num="05" title="Future Scenarios">
          <div className="sim-bands">
            {synthesisData.bull && <ScenarioBand label="Bull" cls="band-bull" text={synthesisData.bull} />}
            {synthesisData.base && <ScenarioBand label="Base" cls="band-base" text={synthesisData.base} />}
            {synthesisData.bear && <ScenarioBand label="Bear" cls="band-bear" text={synthesisData.bear} />}
          </div>
        </DashSection>
      )}

      {/* ── 06 India GTM Strategy ─────────────────────────────────────── */}
      {synthesisData?.gtm_strategy && (
        <DashSection num="06" title="India GTM Strategy">
          <div className="gtm-body">
            {synthesisData.gtm_strategy.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </DashSection>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
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


/* ─────────────────────────────────────────────────────────────────────────
   Layout helpers
───────────────────────────────────────────────────────────────────────── */

function DashSection({ num, title, children }) {
  return (
    <div className="dash-section">
      <div className="section-header">
        <span className="section-num">{num}</span>
        <h2 className="section-title">{title}</h2>
      </div>
      {children}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Prominent Verdict Banner
───────────────────────────────────────────────────────────────────────── */

function VerdictBannerHero({ data }) {
  const vc = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION
  return (
    <div className={`verdict-hero ${vc.cls}`}>
      <span className="verdict-hero-icon">{vc.icon}</span>
      <div className="verdict-hero-text">
        <span className="verdict-hero-label">{vc.label}</span>
        <span className="verdict-hero-score">Risk Score {data.risk_score}/100</span>
      </div>
      <div className="verdict-hero-counts">
        <span className="vhc-critical">{data.counts?.CRITICAL ?? 0} CRITICAL</span>
        <span className="vhc-sep">·</span>
        <span className="vhc-high">{data.counts?.HIGH ?? 0} HIGH</span>
        <span className="vhc-sep">·</span>
        <span className="vhc-medium">{data.counts?.MEDIUM ?? 0} MEDIUM</span>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Intake Summary
───────────────────────────────────────────────────────────────────────── */

function IntakeSummary({ data }) {
  const fields = [
    { key: 'core_decision', label: 'Core Decision' },
    { key: 'market',        label: 'Market Context' },
    { key: 'stated_beliefs',label: 'Stated Beliefs' },
    { key: 'financial_posture', label: 'Financial Posture' },
    { key: 'gaps',          label: 'Identified Gaps' },
  ]
  const answers = data.follow_up_answers || {}
  const questions = data.follow_up_questions || []

  return (
    <div className="intake-summary">
      <div className="intake-grid">
        {fields.map(({ key, label }) =>
          data[key] ? (
            <div key={key} className={`intake-field ${key === 'core_decision' ? 'intake-field--wide' : ''}`}>
              <p className="field-label">{label}</p>
              <p className="field-value">{data[key]}</p>
            </div>
          ) : null
        )}
      </div>
      {Object.keys(answers).length > 0 && (
        <div className="intake-answers">
          <p className="field-label">Follow-up Clarifications</p>
          {Object.entries(answers).map(([k, v]) => {
            const q = questions.find(q => q.id === k)
            return (
              <div key={k} className="intake-answer-row">
                <span className="intake-q">{q?.question || k}</span>
                <span className="intake-a">{String(v)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Risk Score Card
───────────────────────────────────────────────────────────────────────── */

function RiskScoreCard({ data }) {
  const vc = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION
  const pct = data.risk_score

  return (
    <div className={`risk-score-card ${vc.cls}`}>
      <div className="risk-left">
        <svg viewBox="0 0 120 70" className="gauge-svg">
          <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
          <path d="M10,60 A50,50 0 0,1 110,60" fill="none"
            stroke={pct >= 80 ? '#ef4444' : pct >= 50 ? '#f97316' : '#22c55e'}
            strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 157} 157`} />
          <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="#f1f5f9">{pct}</text>
          <text x="60" y="70" textAnchor="middle" fontSize="7" fill="#64748b">/100</text>
        </svg>
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
          <div className="score-row score-bonus">
            <span className="score-row-label">Cross-agent CRITICAL</span>
            <span>+{data.bonus_critical_convergence}</span>
          </div>
        )}
        {data.bonus_high_convergence > 0 && (
          <div className="score-row score-bonus">
            <span className="score-row-label">Cross-agent HIGH</span>
            <span>+{data.bonus_high_convergence}</span>
          </div>
        )}
        <div className="score-row score-total">
          <span className="score-row-label">Total (capped 100)</span>
          <span>{pct}</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Remediation Roadmap SVG
───────────────────────────────────────────────────────────────────────── */

const _SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }

function _topFinding(agentFindings) {
  if (!agentFindings?.length) return null
  return [...agentFindings].sort((a, b) =>
    (_SEV_RANK[a.severity] ?? 3) - (_SEV_RANK[b.severity] ?? 3)
  )[0]
}

function _truncate(str, n) {
  return str && str.length > n ? str.slice(0, n - 1) + '…' : (str || '')
}

function RemediationRoadmap({ agents, verdict }) {
  const vc = VERDICT_CONFIG[verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION

  const verdictFill = verdict === 'DO_NOT_PROCEED' ? '#450a0a'
    : verdict === 'PROCEED_WITH_CAUTION' ? '#431407' : '#052e16'
  const verdictStroke = verdict === 'DO_NOT_PROCEED' ? '#dc2626'
    : verdict === 'PROCEED_WITH_CAUTION' ? '#ea580c' : '#16a34a'
  const verdictTextColor = verdict === 'DO_NOT_PROCEED' ? '#fca5a5'
    : verdict === 'PROCEED_WITH_CAUTION' ? '#fdba74' : '#86efac'

  const ROW_H = 62
  const ROWS = ALL_AGENTS.length
  const SVG_H = ROWS * ROW_H + 10
  const SVG_W = 900

  // Column x positions
  const LX = 8, LW = 268       // findings: left edge, width
  const CX = 348, CW = 210     // actions
  const VX = 628, VW = 260     // verdict
  const VY = 8, VH = SVG_H - 16

  const verdictCY = VY + VH / 2

  return (
    <div className="roadmap-wrapper">
      <div className="roadmap-legend">
        <span className="rl-item rl-finding">Finding (per agent)</span>
        <span className="rl-sep">→</span>
        <span className="rl-item rl-action">Remediation Action</span>
        <span className="rl-sep">→</span>
        <span className="rl-item rl-verdict">Verdict</span>
      </div>
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="roadmap-svg" aria-label="Remediation roadmap">
        {/* Verdict box */}
        <rect x={VX} y={VY} width={VW} height={VH} rx="8"
          fill={verdictFill} stroke={verdictStroke} strokeWidth="1.5" />
        <text x={VX + VW / 2} y={verdictCY - 16} textAnchor="middle"
          fontSize="18" fill={verdictTextColor}>{vc.icon}</text>
        <text x={VX + VW / 2} y={verdictCY + 8} textAnchor="middle"
          fontSize="10" fontWeight="700" fill={verdictTextColor} letterSpacing="0.05em">
          {vc.label}
        </text>

        {ALL_AGENTS.map((name, i) => {
          const cy = i * ROW_H + ROW_H / 2 + 5
          const finding = _topFinding(agents[name]?.findings)
          const sev = finding?.severity || 'MEDIUM'
          const sevFill = sev === 'CRITICAL' ? '#450a0a' : sev === 'HIGH' ? '#431407' : '#422006'
          const sevStroke = sev === 'CRITICAL' ? '#dc2626' : sev === 'HIGH' ? '#ea580c' : '#ca8a04'
          const sevText = sev === 'CRITICAL' ? '#fca5a5' : sev === 'HIGH' ? '#fdba74' : '#fde68a'

          const findingText = finding
            ? _truncate(finding.vulnerability, 42)
            : 'No findings'
          const actionText = _truncate(AGENT_REMEDIATION[name], 38)

          return (
            <g key={name}>
              {/* Finding box */}
              <rect x={LX} y={cy - 22} width={LW} height={44} rx="5"
                fill={finding ? sevFill : '#1e293b'} stroke={finding ? sevStroke : '#334155'} strokeWidth="1" />
              <text x={LX + 6} y={cy - 8} fontSize="8.5" fontWeight="600"
                fill={finding ? sevText : '#475569'} letterSpacing="0.04em">
                {AGENT_ICONS[name]} {AGENT_LABELS[name].toUpperCase()}
              </text>
              <text x={LX + 6} y={cy + 8} fontSize="9.5" fill="#e2e8f0">
                {findingText}
              </text>

              {/* Connector: finding → action */}
              <line x1={LX + LW} y1={cy} x2={CX} y2={cy}
                stroke="#334155" strokeWidth="1.5" markerEnd="url(#arrow)" />

              {/* Action box */}
              <rect x={CX} y={cy - 22} width={CW} height={44} rx="5"
                fill="#0f172a" stroke="#4f46e5" strokeWidth="1" />
              <text x={CX + 6} y={cy - 6} fontSize="8.5" fill="#a5b4fc" fontWeight="600">REMEDIATION</text>
              <text x={CX + 6} y={cy + 9} fontSize="9.5" fill="#c7d2fe">{actionText}</text>

              {/* Connector: action → verdict */}
              <line x1={CX + CW} y1={cy} x2={VX} y2={verdictCY}
                stroke="#334155" strokeWidth="1" strokeDasharray="4 3" />
            </g>
          )
        })}

        {/* Arrow marker */}
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
      </svg>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Scenario bands
───────────────────────────────────────────────────────────────────────── */

function ScenarioBand({ label, cls, text }) {
  return (
    <div className={`scenario-band ${cls}`}>
      <span className="band-label">{label}</span>
      <p className="band-text">{text}</p>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Agent Card
───────────────────────────────────────────────────────────────────────── */

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
      {status === 'error' && <div className="agent-error-body"><p>{errorMsg}</p></div>}
      {status === 'complete' && findings.length === 0 && <p className="agent-empty">No findings.</p>}
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

/* ─────────────────────────────────────────────────────────────────────────
   Finding Row
───────────────────────────────────────────────────────────────────────── */

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(false)
  const sev = SEV_CONFIG[finding.severity] || SEV_CONFIG.MEDIUM

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
          {finding.sources?.length > 0 && (
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

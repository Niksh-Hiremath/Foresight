import { useState, useRef, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as d3 from 'd3'
import Sidebar from '../components/Sidebar'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/* ── Constants ─────────────────────────────────────────────────────── */

const ALL_AGENTS = ['cfo', 'market', 'competitor', 'legal', 'execution']

const AGENT_META = {
  cfo:        { label: 'CFO Agent',        icon: 'account_balance',  remediation: 'Independent financial audit & metrics definition' },
  market:     { label: 'Market Agent',     icon: 'trending_up',      remediation: 'Third-party market validation study' },
  competitor: { label: 'Competitor Agent', icon: 'radar',            remediation: 'Competitive intelligence deep-dive' },
  legal:      { label: 'Legal Agent',      icon: 'gavel',            remediation: 'Legal & compliance review (DPDP / sector-specific)' },
  execution:  { label: 'Exec Agent',       icon: 'rocket_launch',    remediation: 'Execution risk assessment & capability audit' },
}

const SEV_CONFIG = {
  CRITICAL: { label: 'CRITICAL', color: '#fca5a5', bg: '#450a0a', border: '#dc2626' },
  HIGH:     { label: 'HIGH',     color: '#fdba74', bg: '#431407', border: '#ea580c' },
  MEDIUM:   { label: 'MEDIUM',   color: '#fde68a', bg: '#422006', border: '#ca8a04' },
}

const VERDICT_CONFIG = {
  DO_NOT_PROCEED:       { label: 'DO NOT PROCEED',       icon: '🚫', color: '#fca5a5', bg: '#450a0a', border: '#dc2626' },
  PROCEED_WITH_CAUTION: { label: 'PROCEED WITH CAUTION', icon: '⚠️', color: '#fdba74', bg: '#431407', border: '#ea580c' },
  PROCEED:              { label: 'PROCEED',               icon: '✅', color: '#86efac', bg: '#052e16', border: '#16a34a' },
}

const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }

function initAgents() {
  return Object.fromEntries(ALL_AGENTS.map(a => [a, { status: 'waiting', findings: [] }]))
}

function renderBold(text) {
  if (!text) return text
  const parts = String(text).split(/(\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  )
}

function downloadMd(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function saveSession(id, filename) {
  try {
    const existing = JSON.parse(localStorage.getItem('foresight_sessions') || '[]')
    const filtered = existing.filter(s => s.id !== id)
    filtered.push({ id, filename, timestamp: new Date().toISOString() })
    localStorage.setItem('foresight_sessions', JSON.stringify(filtered.slice(-50)))
  } catch {}
}

/* ── Phase progress helpers ─────────────────────────────────────────── */

function getPhaseProgress(progress, pipelineStage, done) {
  if (done) return { p1: 100, p2: 100, p3: 100 }
  const p1 = Math.min(100, (Math.min(progress, 90) / 90) * 100)
  const p2 = Math.min(100, Math.max(0, ((progress - 90) / 7) * 100))
  const p3 = Math.min(100, Math.max(0, ((progress - 97) / 3) * 100))
  return { p1, p2, p3 }
}

function getPhaseStatus(progress, pipelineStage, done) {
  if (done) return { p1: 'done', p2: 'done', p3: 'done' }
  const PHASE1_STAGES = ['agents', 'scoring']
  const PHASE2_STAGES = ['simulating']
  const PHASE3_STAGES = ['gtm', 'synthesizing']
  if (!pipelineStage) return { p1: 'pending', p2: 'pending', p3: 'pending' }
  if (PHASE1_STAGES.includes(pipelineStage)) return { p1: 'active', p2: 'pending', p3: 'pending' }
  if (PHASE2_STAGES.includes(pipelineStage)) return { p1: 'done', p2: 'active', p3: 'pending' }
  if (PHASE3_STAGES.includes(pipelineStage)) return { p1: 'done', p2: 'done', p3: 'active' }
  return { p1: 'pending', p2: 'pending', p3: 'pending' }
}

/* ── Main Component ─────────────────────────────────────────────────── */

export default function AgentsPage() {
  const [searchParams] = useSearchParams()
  const preloadId = searchParams.get('decision_id') || ''

  // Intake state
  const [step, setStep] = useState(preloadId ? 'done' : 'idle')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [decisionId, setDecisionId] = useState(preloadId)
  const [filename, setFilename] = useState('')
  const [decisionContext, setDecisionContext] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})

  // Analysis state
  const [agents, setAgents] = useState(initAgents)
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [pipelineStage, setPipelineStage] = useState(null)
  const [simProgress, setSimProgress] = useState({ phase: '', pct: 0 })
  const [scoreData, setScoreData] = useState(null)
  const [synthesisData, setSynthesisData] = useState(null)
  const [intakeData, setIntakeData] = useState(null)
  const [reports, setReports] = useState({ agentsReport: '', swarmReport: '', gtmReport: '' })
  const [runError, setRunError] = useState('')
  const [eventLog, setEventLog] = useState([])

  const fileInputRef = useRef(null)
  const abortRef = useRef(null)

  const pushEvent = useCallback((entry) => {
    setEventLog(prev => [...prev.slice(-49), { ...entry, id: Date.now() + Math.random() }])
  }, [])

  const updateAgent = useCallback((name, patch) => {
    setAgents(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }, [])

  const fetchReports = useCallback(async (id) => {
    try {
      const r = await fetch(`${API}/reports/${id}`)
      if (!r.ok) return
      const data = await r.json()
      setReports({
        agentsReport: data.agents_report_md || '',
        swarmReport:  data.swarm_report_md  || '',
        gtmReport:    data.gtm_report_md    || '',
      })
    } catch {}
  }, [])

  const loadPersistedData = useCallback(async (id) => {
    fetch(`${API}/intake/context/${id}`)
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setIntakeData(d) }).catch(() => {})

    fetch(`${API}/agents/score/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setScoreData(d) }).catch(() => {})

    fetch(`${API}/agents/findings/${id}`)
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

    Promise.all([
      fetch(`${API}/synthesize/${id}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/simulate/result/${id}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([synth, sim]) => {
      if (synth || sim) {
        setSynthesisData({
          ...(synth || {}),
          bull: sim?.bull || synth?.bull,
          base: sim?.base || synth?.base,
          bear: sim?.bear || synth?.bear,
        })
      }
    })

    fetchReports(id)
  }, [fetchReports])

  // Load from URL param on mount
  useEffect(() => {
    if (preloadId) {
      setDecisionId(preloadId)
      setStep('done')
      loadPersistedData(preloadId)
    }
  }, [preloadId, loadPersistedData])

  /* ── Intake flow ─────────────────────────────────────────────────── */

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError('')
    setStep('uploading')
    setFilename(file.name)

    try {
      const form = new FormData()
      form.append('file', file)
      const upRes = await fetch(`${API}/intake/upload`, { method: 'POST', body: form })
      if (!upRes.ok) throw new Error(`Upload failed: ${upRes.status}`)
      const { decision_id } = await upRes.json()
      setDecisionId(decision_id)

      setStep('analyzing')
      const anRes = await fetch(`${API}/intake/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id }),
      })
      if (!anRes.ok) throw new Error(`Analysis failed: ${anRes.status}`)
      const data = await anRes.json()
      setDecisionContext(data.decision_context)
      setQuestions(data.follow_up_questions || [])
      const initial = {}
      ;(data.follow_up_questions || []).forEach(q => { initial[q.id] = '' })
      setAnswers(initial)
      setStep('questions')
    } catch (err) {
      setError(err.message)
      setStep('idle')
    }
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleAnswer = (id, value) => setAnswers(prev => ({ ...prev, [id]: value }))

  const submitAnswers = async () => {
    setError('')
    setStep('submitting')
    try {
      const res = await fetch(`${API}/intake/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: decisionId, answers }),
      })
      if (!res.ok) throw new Error(`Submit failed: ${res.status}`)
      setStep('ready')
    } catch (err) {
      setError(err.message)
      setStep('questions')
    }
  }

  const allAnswered = questions.every(q => (answers[q.id] || '').trim() !== '')

  /* ── Analysis run ─────────────────────────────────────────────────── */

  const runAnalysis = useCallback(async () => {
    const id = decisionId.trim()
    if (!id) return

    setAgents(initAgents())
    setProgress(0)
    setRunning(true)
    setRunError('')
    setScoreData(null)
    setSynthesisData(null)
    setPipelineStage('agents')
    setSimProgress({ phase: '', pct: 0 })
    setReports({ agentsReport: '', swarmReport: '', gtmReport: '' })
    setStep('running')
    setEventLog([])

    saveSession(id, filename)

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
          try { handleEvent(JSON.parse(raw)) } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') setRunError(err.message)
    } finally {
      setRunning(false)
      setPipelineStage(null)
    }

    function handleEvent(ev) {
      const ts = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      switch (ev.event) {
        case 'agent_start':
          updateAgent(ev.agent, { status: 'thinking' })
          setPipelineStage('agents')
          pushEvent({ type: 'agent_start', agent: ev.agent, ts })
          break
        case 'agent_complete':
          updateAgent(ev.agent, { status: 'complete', findings: ev.findings || [] })
          setProgress(ev.progress || 0)
          pushEvent({ type: 'agent_complete', agent: ev.agent, count: (ev.findings || []).length, ts })
          break
        case 'agent_error':
          updateAgent(ev.agent, { status: 'error', errorMsg: ev.error || 'Unknown error' })
          pushEvent({ type: 'agent_error', agent: ev.agent, ts })
          break
        case 'scoring':
          setPipelineStage('scoring')
          setProgress(ev.progress || 90)
          setScoreData(ev)
          pushEvent({ type: 'scoring', score: ev.risk_score, verdict: ev.verdict, ts })
          break
        case 'simulating':
          setPipelineStage('simulating')
          setProgress(ev.progress || 93)
          pushEvent({ type: 'simulating', ts })
          break
        case 'sim_progress':
          setPipelineStage('simulating')
          setSimProgress({ phase: ev.phase || '', pct: ev.pct || 0 })
          break
        case 'gtm_start':
          setPipelineStage('gtm')
          setProgress(ev.progress || 94)
          pushEvent({ type: 'gtm_start', ts })
          break
        case 'synthesizing':
          setPipelineStage('synthesizing')
          setProgress(ev.progress || 97)
          pushEvent({ type: 'synthesizing', ts })
          break
        case 'complete':
          setProgress(100)
          setStep('done')
          if (ev.score) setScoreData(ev.score)
          if (ev.report) setSynthesisData(ev.report)
          if (ev.reports_ready) fetchReports(id)
          pushEvent({ type: 'complete', ts })
          break
      }
    }
  }, [decisionId, filename, updateAgent, fetchReports, pushEvent])

  const cancelRun = () => {
    abortRef.current?.abort()
    setRunning(false)
    setPipelineStage(null)
    setStep('done')
  }

  const resetAll = () => {
    setStep('idle')
    setDecisionId('')
    setFilename('')
    setDecisionContext(null)
    setQuestions([])
    setAnswers({})
    setAgents(initAgents())
    setProgress(0)
    setScoreData(null)
    setSynthesisData(null)
    setIntakeData(null)
    setReports({ agentsReport: '', swarmReport: '', gtmReport: '' })
    setRunError('')
    setError('')
  }

  /* ── Phase bar data ─────────────────────────────────────────────── */
  const phaseProgress = getPhaseProgress(progress, pipelineStage, step === 'done' && !running)
  const phaseStatus = getPhaseStatus(progress, pipelineStage, step === 'done' && !running)
  const showAnalysis = step === 'running' || step === 'done'
  const slug = decisionId.slice(0, 8) || 'report'

  return (
    <div className="bg-grid text-on-surface relative min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="fixed inset-0 pointer-events-none bg-grid-pattern opacity-40 z-0" />
      <Sidebar />

      <main className="ml-64 min-h-screen relative z-10 flex flex-col">

        {/* ── INTAKE FLOW ─────────────────────────────────────────── */}
        {!showAnalysis && (
          <div className="p-8 md:p-12 flex flex-col gap-8 flex-1">
            {/* Page header */}
            <div className="border-b border-outline-variant pb-6">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-2 h-2 bg-primary-container rounded-full animate-pulse" />
                <span className="text-[11px] text-primary-container uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  FORESIGHT ENGINE
                </span>
              </div>
              <h1 className="font-bold text-on-surface uppercase tracking-tighter" style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem' }}>
                AGENT <span className="text-primary-container">ANALYSIS</span>
              </h1>
              <p className="text-sm text-on-surface-variant mt-2">
                Upload your decision document to begin the multi-agent red-team assessment.
              </p>
            </div>

            {/* ── IDLE: Drop Zone ── */}
            {step === 'idle' && (
              <DropZone
                dragging={dragging}
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onBrowse={() => fileInputRef.current?.click()}
                fileInputRef={fileInputRef}
                onFileInput={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
                error={error}
              />
            )}

            {/* ── UPLOADING ── */}
            {step === 'uploading' && (
              <StatusCard
                icon="cloud_upload"
                title={<>Uploading <span className="text-primary-container">{filename}</span></>}
                sub="Extracting text and indexing into RAG…"
              />
            )}

            {/* ── ANALYZING ── */}
            {step === 'analyzing' && (
              <StatusCard
                icon="psychology"
                title="Analyzing Document"
                sub="Running LLM extraction — identifying decision context and gaps…"
              />
            )}

            {/* ── QUESTIONS / SUBMITTING ── */}
            {(step === 'questions' || step === 'submitting') && decisionContext && (
              <QuestionsView
                context={decisionContext}
                filename={filename}
                questions={questions}
                answers={answers}
                onChange={handleAnswer}
                onSubmit={submitAnswers}
                allAnswered={allAnswered}
                submitting={step === 'submitting'}
                error={error}
              />
            )}

            {/* ── READY ── */}
            {step === 'ready' && (
              <ReadyView
                decisionId={decisionId}
                filename={filename}
                context={decisionContext}
                onLaunch={runAnalysis}
                onReset={resetAll}
              />
            )}
          </div>
        )}

        {/* ── ANALYSIS VIEW ──────────────────────────────────────── */}
        {showAnalysis && (
          <div className="flex flex-col">
            {/* Sticky top bar with phase progress */}
            <div className="sticky top-0 z-20 bg-surface-container-lowest/95 backdrop-blur-sm border-b border-outline-variant px-8 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    DECISION: <span className="text-primary-container">{decisionId}</span>
                  </span>
                  {filename && (
                    <span className="text-[10px] text-on-surface-variant/60 border border-outline-variant/50 px-2 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {filename}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {running ? (
                    <>
                      <div className="thinking-dots"><span /><span /><span /></div>
                      <button onClick={cancelRun} className="text-[11px] text-on-surface-variant hover:text-primary-container border border-outline-variant hover:border-primary-container/50 px-3 py-1 rounded transition-all uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        CANCEL
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={runAnalysis} className="text-[11px] bg-primary-container text-on-primary-container px-4 py-1.5 rounded uppercase tracking-widest hover:bg-primary transition-colors" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        RE-RUN →
                      </button>
                      <button onClick={resetAll} className="text-[11px] text-on-surface-variant hover:text-on-surface border border-outline-variant px-3 py-1 rounded transition-all uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        RESET
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Phase Bar */}
              <PhasesBar phaseProgress={phaseProgress} phaseStatus={phaseStatus} simProgress={simProgress} running={running} pipelineStage={pipelineStage} />

              {runError && (
                <p className="mt-2 text-[11px] text-red-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{runError}</p>
              )}
            </div>

            {/* Two-column layout: results + agent side panel */}
            <div className="flex">

            {/* Left: Results sections */}
            <div className="flex-1 min-w-0 p-8 flex flex-col gap-8">
              {/* Verdict Banner — pinned to top once pipeline completes */}
              {scoreData && step === 'done' && !running && <VerdictBanner data={scoreData} />}

              {/* Swarm progress during simulation */}
              {running && pipelineStage === 'simulating' && simProgress.phase && (
                <div className="bg-surface-container border border-outline-variant p-4 rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{simProgress.phase}</span>
                    <span className="text-[11px] text-primary-container" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{simProgress.pct}%</span>
                  </div>
                  <div className="h-1 bg-surface-container-highest rounded-full overflow-hidden">
                    <div className="h-full bg-primary-container rounded-full transition-all duration-300" style={{ width: `${simProgress.pct}%` }} />
                  </div>
                </div>
              )}

              {/* 01 Decision Context */}
              {intakeData && (
                <DashSection num="01" title="Decision Context">
                  <IntakeSummary data={intakeData} />
                </DashSection>
              )}

              {/* 02 Agent Analysis */}
              <DashSection num="02" title="Agent Analysis">
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  {ALL_AGENTS.map(name => (
                    <AgentCard key={name} name={name} state={agents[name]} />
                  ))}
                </div>
              </DashSection>

              {/* 03 Risk Assessment */}
              {scoreData && (
                <DashSection num="03" title="Risk Assessment">
                  <RiskScoreCard data={scoreData} />
                  {synthesisData?.executive_summary && (
                    <div className="mt-4 p-4 bg-surface-container border border-outline-variant rounded">
                      <p className="text-[11px] text-on-surface-variant uppercase tracking-widest mb-2" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Executive Summary</p>
                      <p className="text-sm text-on-surface leading-relaxed">{renderBold(synthesisData.executive_summary)}</p>
                    </div>
                  )}
                  {synthesisData?.key_questions?.length > 0 && (
                    <div className="mt-4 p-4 bg-surface-container border border-outline-variant rounded">
                      <p className="text-[11px] text-on-surface-variant uppercase tracking-widest mb-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>3 Questions Before Signing</p>
                      <ol className="space-y-2">
                        {synthesisData.key_questions.map((q, i) => (
                          <li key={i} className="text-sm text-on-surface flex gap-3">
                            <span className="text-primary-container shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Q{i + 1}</span>
                            {renderBold(q)}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </DashSection>
              )}

              {/* 04 Remediation Roadmap */}
              {scoreData && !running && (
                <DashSection num="04" title="Remediation Roadmap">
                  <RemediationRoadmap agents={agents} verdict={scoreData.verdict} />
                </DashSection>
              )}

              {/* 05 Future Scenarios */}
              {(synthesisData?.bull || synthesisData?.base || synthesisData?.bear) && (
                <DashSection num="05" title="Future Scenarios">
                  <div className="flex flex-col gap-3">
                    {synthesisData.bull && <ScenarioBand label="Bull" color="#22c55e" bg="rgba(34,197,94,0.06)" border="rgba(34,197,94,0.2)" text={synthesisData.bull} />}
                    {synthesisData.base && <ScenarioBand label="Base" color="#60a5fa" bg="rgba(96,165,250,0.06)" border="rgba(96,165,250,0.2)" text={synthesisData.base} />}
                    {synthesisData.bear && <ScenarioBand label="Bear" color="#ef4444" bg="rgba(239,68,68,0.06)" border="rgba(239,68,68,0.2)" text={synthesisData.bear} />}
                  </div>
                </DashSection>
              )}

              {/* 06 India GTM Strategy */}
              {synthesisData?.gtm_strategy && (
                <DashSection num="06" title="India GTM Strategy">
                  <div className="p-4 bg-surface-container border border-outline-variant rounded space-y-3">
                    {synthesisData.gtm_strategy.split('\n\n').map((para, i) => (
                      <p key={i} className="text-sm text-on-surface leading-relaxed">{renderBold(para)}</p>
                    ))}
                  </div>
                </DashSection>
              )}

              {/* 07 Five-Agent Report */}
              {reports.agentsReport && (
                <DashSectionDownload num="07" title="Five-Agent Report" onDownload={() => downloadMd(reports.agentsReport, `agents-report-${slug}.md`)}>
                  <ReportDoc content={reports.agentsReport} />
                </DashSectionDownload>
              )}

              {/* 08 Swarm Report */}
              {reports.swarmReport && (
                <DashSectionDownload num="08" title="Agent Swarm Report" onDownload={() => downloadMd(reports.swarmReport, `swarm-report-${slug}.md`)}>
                  <ReportDoc content={reports.swarmReport} />
                </DashSectionDownload>
              )}

              {/* 09 GTM Strategy Report */}
              {reports.gtmReport && (
                <DashSectionDownload num="09" title="GTM Strategy Report" onDownload={() => downloadMd(reports.gtmReport, `gtm-report-${slug}.md`)}>
                  <ReportDoc content={reports.gtmReport} />
                </DashSectionDownload>
              )}
            </div>

            {/* Right: Agent status panel */}
            <aside className="w-72 shrink-0 border-l border-outline-variant bg-surface-container-lowest/30">
              <div className="px-4 pt-6 pb-6 flex flex-col gap-3">
                <AgentSidePanel
                  agents={agents}
                  pipelineStage={pipelineStage}
                  running={running}
                  simProgress={simProgress}
                  step={step}
                  eventLog={eventLog}
                  decisionId={decisionId}
                />
              </div>
            </aside>

            </div>{/* end two-column */}
          </div>
        )}
      </main>
    </div>
  )
}

/* ── Phase Bar ──────────────────────────────────────────────────────── */

function PhasesBar({ phaseProgress, phaseStatus, simProgress, running, pipelineStage }) {
  const phases = [
    { key: 'p1', label: 'PHASE 1', sub: 'AGENT ASSESSMENT',  pct: phaseProgress.p1, status: phaseStatus.p1 },
    { key: 'p2', label: 'PHASE 2', sub: 'SWARM SIMULATION',  pct: phaseProgress.p2, status: phaseStatus.p2 },
    { key: 'p3', label: 'PHASE 3', sub: 'GTM GENERATION',     pct: phaseProgress.p3, status: phaseStatus.p3 },
  ]

  return (
    <div className="flex gap-4">
      {phases.map(phase => (
        <div key={phase.key} className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              {phase.status === 'done' && <span className="text-primary-container text-xs material-symbols-outlined">check_circle</span>}
              {phase.status === 'active' && <div className="thinking-dots"><span /><span /><span /></div>}
              {phase.status === 'pending' && <span className="w-3 h-3 rounded-full border border-outline-variant inline-block" />}
              <span className="text-[10px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {phase.label}
              </span>
            </div>
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: phase.status === 'done' ? '#ff544c' : phase.status === 'active' ? '#e5e2e1' : '#5b403d' }}
            >
              {phase.sub}
            </span>
          </div>
          <div className="h-1 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${phase.pct}%`,
                backgroundColor: phase.status === 'done' ? '#ff544c' : phase.status === 'active' ? '#ffb4ac' : '#5b403d',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Drop Zone ──────────────────────────────────────────────────────── */

function DropZone({ dragging, onDrop, onDragOver, onDragLeave, onBrowse, fileInputRef, onFileInput, error }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface-container border border-outline-variant p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary-container/5 blur-3xl rounded-full pointer-events-none" />

        <div className="flex items-start justify-between mb-6 relative z-10">
          <h2 className="text-on-surface uppercase flex items-center gap-2 font-semibold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', fontSize: '1.1rem' }}>
            <span className="w-1 h-6 bg-primary-container inline-block" />
            TACTICAL INGESTION
          </h2>
          <span className="text-[10px] text-on-surface-variant px-2 py-1 bg-surface-container-lowest border border-outline-variant/50 rounded uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            DROP ZONE ACTIVE
          </span>
        </div>

        <div
          className={`tactical-border scanline-effect relative h-56 w-full flex flex-col items-center justify-center transition-colors cursor-pointer ${dragging ? 'border-primary-container bg-primary-container/5' : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={onBrowse}
        >
          <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-4">cloud_upload</span>
          <p className="text-sm text-on-surface mb-1">Drag &amp; drop your document here</p>
          <p className="text-[11px] text-on-surface-variant mb-6" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            PDF · DOCX · TXT — up to 20 MB
          </p>
          <button
            className="px-8 py-3 bg-primary-container/10 border border-primary-container text-primary-container uppercase tracking-widest hover:bg-primary-container/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2"
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}
            type="button"
            onClick={e => { e.stopPropagation(); onBrowse() }}
          >
            <span className="material-symbols-outlined text-sm">add</span>
            BROWSE FILES
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt" onChange={onFileInput} hidden />
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-400 border border-red-900/50 bg-red-950/30 px-4 py-3 rounded">
          <span className="material-symbols-outlined text-sm">error</span>
          <span className="text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{error}</span>
        </div>
      )}
    </div>
  )
}

/* ── Status Card ────────────────────────────────────────────────────── */

function StatusCard({ icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center">
          <span className="material-symbols-outlined text-3xl text-primary-container">{icon}</span>
        </div>
        <div className="absolute -bottom-1 -right-1">
          <div className="thinking-dots"><span /><span /><span /></div>
        </div>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-on-surface uppercase tracking-tight mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
          {title}
        </h2>
        <p className="text-sm text-on-surface-variant">{sub}</p>
      </div>
    </div>
  )
}

/* ── Questions View ─────────────────────────────────────────────────── */

function QuestionsView({ context, filename, questions, answers, onChange, onSubmit, allAnswered, submitting, error }) {
  const fields = [
    { key: 'core_decision',    label: 'Core Decision' },
    { key: 'market',           label: 'Market Context' },
    { key: 'stated_beliefs',   label: 'Stated Beliefs' },
    { key: 'financial_posture',label: 'Financial Posture' },
    { key: 'gaps',             label: 'Identified Gaps' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Context Summary */}
      <div className="bg-surface-container border border-outline-variant p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-on-surface uppercase font-semibold tracking-tight flex items-center gap-2" style={{ fontFamily: 'Syne, sans-serif' }}>
            <span className="w-1 h-5 bg-primary-container inline-block" />
            Decision Context Extracted
          </h2>
          <span className="text-[10px] text-primary-container border border-primary-container/30 px-2 py-1 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            📄 {filename}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fields.map(({ key, label }) =>
            context[key] ? (
              <div key={key} className={`p-3 bg-surface-container-low border border-outline-variant/50 rounded ${key === 'core_decision' ? 'md:col-span-2' : ''} ${key === 'gaps' ? 'border-primary-container/30 bg-primary-container/5' : ''}`}>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{label}</p>
                <p className="text-sm text-on-surface leading-relaxed">{renderBold(context[key])}</p>
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* Follow-up Questions */}
      <div className="bg-surface-container border border-outline-variant p-6">
        <h3 className="text-on-surface uppercase font-semibold tracking-tight flex items-center gap-2 mb-1" style={{ fontFamily: 'Syne, sans-serif' }}>
          <span className="w-1 h-5 bg-primary-container inline-block" />
          Follow-up Questions
        </h3>
        <p className="text-[11px] text-on-surface-variant mb-6" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          ANSWER BEFORE RUNNING ADVERSARIAL ANALYSIS — TARGETS IDENTIFIED GAPS
        </p>
        <div className="flex flex-col gap-4">
          {questions.map((q, i) => (
            <div key={q.id} className="border border-outline-variant/50 bg-surface-container-low rounded overflow-hidden flex min-h-[100px]">
              {/* Question — 50% */}
              <div className="w-1/2 p-4 border-r border-outline-variant/30 flex items-start gap-3">
                <span className="shrink-0 text-[10px] text-primary-container border border-primary-container/30 px-1.5 py-0.5 rounded mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  Q{i + 1}
                </span>
                <span className="text-sm text-on-surface leading-relaxed break-words">{q.question}</span>
              </div>
              {/* Answer — 50% */}
              <div className="w-1/2 p-4">
                {q.type === 'mcq' ? (
                  <div className="flex flex-wrap gap-2">
                    {(q.options || []).map(opt => (
                      <label
                        key={opt}
                        className={`flex items-center gap-2 px-3 py-2 border rounded cursor-pointer transition-all text-sm ${answers[q.id] === opt ? 'border-primary-container bg-primary-container/10 text-primary-container' : 'border-outline-variant text-on-surface-variant hover:border-outline'}`}
                      >
                        <input type="radio" name={q.id} value={opt} checked={answers[q.id] === opt} onChange={() => onChange(q.id, opt)} className="hidden" />
                        {opt}
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    className="w-full h-full bg-surface-container-lowest border border-outline-variant text-on-surface text-sm p-3 rounded resize-none focus:outline-none focus:border-primary-container/60 transition-colors placeholder-on-surface-variant/40 min-h-[80px]"
                    placeholder="Your answer…"
                    value={answers[q.id] || ''}
                    onChange={e => onChange(q.id, e.target.value)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-4 text-red-400 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{error}</div>
        )}
        <button
          className="mt-6 w-full bg-primary-container text-on-primary-container py-4 uppercase tracking-widest hover:bg-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
          style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}
          onClick={onSubmit}
          disabled={!allAnswered || submitting}
        >
          {submitting ? 'SAVING…' : 'SUBMIT ANSWERS →'}
        </button>
      </div>
    </div>
  )
}

/* ── Ready View ─────────────────────────────────────────────────────── */

function ReadyView({ decisionId, filename, context, onLaunch, onReset }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Status box */}
      <div className="bg-surface-container border border-primary-container/30 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary-container/5 blur-3xl rounded-full pointer-events-none" />
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-primary-container/20 border border-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-primary-container text-xl">check_circle</span>
          </div>
          <div>
            <p className="text-[10px] text-primary-container uppercase tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>CONTEXT READY</p>
            <p className="text-sm text-on-surface">{filename || 'Document processed successfully'}</p>
          </div>
        </div>
        {context && (
          <div className="p-3 bg-surface-container-low border border-outline-variant/50 rounded">
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Core Decision</p>
            <p className="text-sm text-on-surface">{context.core_decision || '—'}</p>
          </div>
        )}
        <p className="mt-3 text-[11px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          SESSION ID: <span className="text-primary-container">{decisionId}</span>
        </p>
      </div>

      {/* Phase preview */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Phase 1', title: 'Agent Assessment', sub: '5 adversarial agents interrogate your decision', icon: 'groups' },
          { label: 'Phase 2', title: 'Swarm Simulation',  sub: 'Multi-agent swarm models market dynamics',    icon: 'hub' },
          { label: 'Phase 3', title: 'GTM Generation',     sub: 'AI generates India go-to-market strategy',    icon: 'map' },
        ].map(phase => (
          <div key={phase.label} className="bg-surface-container border border-outline-variant p-4 rounded">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-primary-container text-base">{phase.icon}</span>
              <span className="text-[10px] text-primary-container uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{phase.label}</span>
            </div>
            <p className="text-sm text-on-surface font-medium mb-1">{phase.title}</p>
            <p className="text-xs text-on-surface-variant leading-relaxed">{phase.sub}</p>
          </div>
        ))}
      </div>

      {/* Launch button */}
      <div className="flex gap-3">
        <button
          onClick={onLaunch}
          className="flex-1 bg-primary-container text-on-primary-container py-5 uppercase tracking-widest font-bold hover:bg-primary transition-all hover:scale-[1.01] active:scale-[0.99] text-sm flex items-center justify-center gap-3"
          style={{ fontFamily: 'Syne, sans-serif', letterSpacing: '0.1em' }}
        >
          <span className="material-symbols-outlined">rocket_launch</span>
          LAUNCH FORESIGHT SESSION
        </button>
        <button
          onClick={onReset}
          className="px-6 text-on-surface-variant hover:text-on-surface border border-outline-variant hover:border-outline transition-all uppercase text-[11px]"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          RESET
        </button>
      </div>
    </div>
  )
}

/* ── Verdict Banner ─────────────────────────────────────────────────── */

function VerdictBanner({ data }) {
  const vc = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION
  return (
    <div className="p-6 border rounded relative overflow-hidden" style={{ background: vc.bg, borderColor: vc.border }}>
      <div className="alert-stripes absolute inset-0 pointer-events-none opacity-50" />
      <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-4">
          <span className="text-4xl">{vc.icon}</span>
          <div>
            <p className="text-[11px] text-on-surface-variant uppercase tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>VERDICT</p>
            <p className="text-2xl font-bold uppercase tracking-tight" style={{ fontFamily: 'Syne, sans-serif', color: vc.color }}>{vc.label}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold" style={{ color: vc.color, fontFamily: 'JetBrains Mono, monospace' }}>{data.risk_score}</p>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>RISK / 100</p>
          </div>
          <div className="flex gap-4 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <span className="text-red-400">{data.counts?.CRITICAL ?? 0} CRITICAL</span>
            <span className="text-orange-400">{data.counts?.HIGH ?? 0} HIGH</span>
            <span className="text-yellow-400">{data.counts?.MEDIUM ?? 0} MEDIUM</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Intake Summary ─────────────────────────────────────────────────── */

function IntakeSummary({ data }) {
  const fields = [
    { key: 'core_decision',    label: 'Core Decision', wide: true },
    { key: 'market',           label: 'Market Context' },
    { key: 'stated_beliefs',   label: 'Stated Beliefs' },
    { key: 'financial_posture',label: 'Financial Posture' },
    { key: 'gaps',             label: 'Identified Gaps', highlight: true },
  ]
  const answers = data.follow_up_answers || {}
  const questions = data.follow_up_questions || []

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(({ key, label, wide, highlight }) =>
          data[key] ? (
            <div key={key} className={`p-3 bg-surface-container border rounded ${wide ? 'md:col-span-2' : ''} ${highlight ? 'border-primary-container/30 bg-primary-container/5' : 'border-outline-variant/50'}`}>
              <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{label}</p>
              <p className="text-sm text-on-surface leading-relaxed">{renderBold(data[key])}</p>
            </div>
          ) : null
        )}
      </div>
      {Object.keys(answers).length > 0 && (
        <div className="p-4 bg-surface-container border border-outline-variant/50 rounded">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Follow-up Clarifications</p>
          <div className="flex flex-col gap-3">
            {Object.entries(answers).map(([k, v]) => {
              const q = questions.find(q => q.id === k)
              return (
                <div key={k} className="flex flex-col gap-0.5 border-l-2 border-outline-variant/40 pl-3">
                  <span className="text-[11px] text-on-surface-variant break-words leading-relaxed" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{q?.question || k}</span>
                  <span className="text-sm text-on-surface font-medium">{String(v)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Risk Score Card ────────────────────────────────────────────────── */

function RiskScoreCard({ data }) {
  const vc = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION
  const pct = data.risk_score

  return (
    <div className="p-5 bg-surface-container border border-outline-variant rounded flex flex-col md:flex-row gap-6 items-center">
      {/* Gauge */}
      <div className="shrink-0">
        <svg viewBox="0 0 120 70" className="w-36">
          <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
          <path d="M10,60 A50,50 0 0,1 110,60" fill="none"
            stroke={pct >= 80 ? '#ef4444' : pct >= 50 ? '#f97316' : '#22c55e'}
            strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 157} 157`} />
          <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="#e5e2e1">{pct}</text>
          <text x="60" y="70" textAnchor="middle" fontSize="7" fill="#5b403d">/100</text>
        </svg>
      </div>

      {/* Verdict + counts */}
      <div className="flex flex-col gap-2">
        <span className="text-lg font-bold uppercase" style={{ fontFamily: 'Syne, sans-serif', color: vc.color }}>{vc.icon} {vc.label}</span>
        <div className="flex gap-4 text-[11px]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          <span className="text-red-400">{data.counts?.CRITICAL ?? 0} critical</span>
          <span className="text-orange-400">{data.counts?.HIGH ?? 0} high</span>
          <span className="text-yellow-400">{data.counts?.MEDIUM ?? 0} medium</span>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="ml-auto text-[11px] space-y-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        <div className="flex gap-6 text-on-surface-variant">
          <span>Base score</span><span className="text-on-surface">{data.base_score}</span>
        </div>
        {data.bonus_critical_convergence > 0 && (
          <div className="flex gap-6 text-orange-400">
            <span>Cross-agent CRITICAL</span><span>+{data.bonus_critical_convergence}</span>
          </div>
        )}
        {data.bonus_high_convergence > 0 && (
          <div className="flex gap-6 text-yellow-400">
            <span>Cross-agent HIGH</span><span>+{data.bonus_high_convergence}</span>
          </div>
        )}
        <div className="flex gap-6 text-on-surface border-t border-outline-variant pt-1">
          <span>Total (capped 100)</span><span className="font-bold">{pct}</span>
        </div>
      </div>
    </div>
  )
}

/* ── Remediation Roadmap ────────────────────────────────────────────── */

function RemediationRoadmap({ agents, verdict }) {
  const vc = VERDICT_CONFIG[verdict] || VERDICT_CONFIG.PROCEED_WITH_CAUTION
  const verdictFill   = verdict === 'DO_NOT_PROCEED' ? '#450a0a' : verdict === 'PROCEED_WITH_CAUTION' ? '#431407' : '#052e16'
  const verdictStroke = verdict === 'DO_NOT_PROCEED' ? '#dc2626' : verdict === 'PROCEED_WITH_CAUTION' ? '#ea580c' : '#16a34a'
  const verdictText   = verdict === 'DO_NOT_PROCEED' ? '#fca5a5' : verdict === 'PROCEED_WITH_CAUTION' ? '#fdba74' : '#86efac'

  return (
    <div>
      {/* Legend */}
      <div className="flex gap-4 text-[10px] text-on-surface-variant mb-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-900 border border-red-600 inline-block" />Finding</span>
        <span className="text-outline-variant">→</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-indigo-950 border border-indigo-500 inline-block" />Remediation</span>
        <span className="text-outline-variant">→</span>
        <span style={{ color: verdictText }}>Verdict</span>
      </div>

      <div className="flex items-stretch gap-3">
        {/* Agent Finding column */}
        <div className="flex flex-col gap-2 flex-1">
          {ALL_AGENTS.map(name => {
            const findings = agents[name]?.findings || []
            const topFinding = findings.length ? [...findings].sort((a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3))[0] : null
            const sev = topFinding?.severity || 'MEDIUM'
            const sc = SEV_CONFIG[sev]
            return (
              <div key={name} className="p-3 rounded border" style={{ background: topFinding ? sc.bg : '#1e293b', borderColor: topFinding ? sc.border : '#334155' }}>
                <p className="text-[9px] font-bold tracking-wider mb-1" style={{ fontFamily: 'JetBrains Mono, monospace', color: topFinding ? sc.color : '#475569' }}>
                  {AGENT_META[name].label.toUpperCase()}
                </p>
                <p className="text-xs leading-snug break-words" style={{ color: '#e2e8f0' }}>
                  {topFinding ? renderBold(topFinding.vulnerability) : 'No findings'}
                </p>
              </div>
            )
          })}
        </div>

        {/* Arrows col 1 */}
        <div className="flex flex-col gap-2">
          {ALL_AGENTS.map(name => (
            <div key={name} className="flex items-center h-full min-h-[52px] text-outline-variant text-lg px-1">→</div>
          ))}
        </div>

        {/* Remediation column */}
        <div className="flex flex-col gap-2 flex-1">
          {ALL_AGENTS.map(name => (
            <div key={name} className="p-3 rounded border" style={{ background: '#0f172a', borderColor: '#4f46e5' }}>
              <p className="text-[9px] font-bold text-indigo-400 tracking-wider mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>REMEDIATION</p>
              <p className="text-xs leading-snug break-words" style={{ color: '#c7d2fe' }}>
                {renderBold(AGENT_META[name].remediation)}
              </p>
            </div>
          ))}
        </div>

        {/* Arrow to verdict */}
        <div className="flex items-center text-outline-variant text-lg px-1">→</div>

        {/* Verdict box — spans full height */}
        <div className="w-44 self-stretch rounded border flex flex-col items-center justify-center gap-3 p-4" style={{ background: verdictFill, borderColor: verdictStroke }}>
          <span className="text-3xl">{vc.icon}</span>
          <p className="text-center text-xs font-bold uppercase tracking-wider leading-snug" style={{ fontFamily: 'JetBrains Mono, monospace', color: verdictText }}>
            {vc.label}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Scenario Band ──────────────────────────────────────────────────── */

function ScenarioBand({ label, color, bg, border, text }) {
  return (
    <div className="p-4 rounded border flex gap-4 items-start" style={{ background: bg, borderColor: border }}>
      <span className="shrink-0 text-[11px] font-bold uppercase px-2 py-1 rounded border" style={{ fontFamily: 'JetBrains Mono, monospace', color, borderColor: border, background: 'rgba(0,0,0,0.3)' }}>
        {label}
      </span>
      <p className="text-sm text-on-surface leading-relaxed">{renderBold(text)}</p>
    </div>
  )
}

/* ── Agent Card ─────────────────────────────────────────────────────── */

function AgentCard({ name, state }) {
  const { status, findings = [], errorMsg } = state
  const meta = AGENT_META[name]

  const statusColors = {
    waiting:  { color: '#5b403d',   bg: 'transparent' },
    thinking: { color: '#ffb4ac',   bg: 'rgba(255,180,172,0.1)' },
    complete: { color: '#ff544c',   bg: 'rgba(255,84,76,0.08)' },
    error:    { color: '#ef4444',   bg: 'rgba(239,68,68,0.1)' },
  }
  const sc = statusColors[status] || statusColors.waiting

  return (
    <div className="bg-surface-container border border-outline-variant rounded p-4 flex flex-col gap-3 transition-all"
      style={{ borderColor: status === 'thinking' ? '#ffb4ac33' : status === 'complete' ? '#ff544c33' : undefined }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-surface-container-lowest border border-outline-variant flex items-center justify-center">
          <span className="material-symbols-outlined text-primary-container text-sm">{meta.icon}</span>
        </div>
        <span className="text-sm font-semibold text-on-surface flex-1" style={{ fontFamily: 'Syne, sans-serif' }}>{meta.label}</span>
        <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono, monospace', color: sc.color, background: sc.bg }}>
          {status === 'waiting' ? 'Waiting' : status === 'thinking' ? 'Analyzing…' : status === 'complete' ? 'Done' : 'Error'}
        </span>
      </div>

      {/* Body */}
      {status === 'thinking' && (
        <div className="flex items-center gap-2 text-[11px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          <div className="thinking-dots"><span /><span /><span /></div>
          <span>Analyzing decision context…</span>
        </div>
      )}
      {status === 'error' && <p className="text-[11px] text-red-400">{errorMsg}</p>}
      {status === 'complete' && findings.length === 0 && (
        <p className="text-[11px] text-on-surface-variant/60">No findings.</p>
      )}
      {status === 'complete' && findings.length > 0 && (
        <div className="flex flex-col gap-1">
          {findings.map(f => <FindingRow key={f.id} finding={f} />)}
        </div>
      )}
    </div>
  )
}

/* ── Finding Row ────────────────────────────────────────────────────── */

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(false)
  const sc = SEV_CONFIG[finding.severity] || SEV_CONFIG.MEDIUM

  return (
    <div className="border border-outline-variant/40 rounded overflow-hidden">
      <div
        className="flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-container-low transition-colors"
        onClick={() => setExpanded(e => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}
      >
        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace', color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}>
          {sc.label}
        </span>
        <span className="text-xs text-on-surface flex-1 break-words">{finding.vulnerability}</span>
        <span className="text-on-surface-variant text-xs material-symbols-outlined">{expanded ? 'expand_less' : 'expand_more'}</span>
      </div>
      {expanded && (
        <div className="p-3 bg-surface-container-lowest border-t border-outline-variant/40 space-y-2">
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Attack Vector</p>
            <p className="text-xs text-on-surface">{finding.attack}</p>
          </div>
          <div>
            <p className="text-[10px] text-on-surface-variant uppercase mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Investor Question</p>
            <p className="text-xs text-primary-container">{finding.question}</p>
          </div>
          {finding.sources?.length > 0 && (
            <div>
              <p className="text-[10px] text-on-surface-variant uppercase mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Sources</p>
              <ul className="text-xs space-y-0.5">
                {finding.sources.map((src, i) => (
                  <li key={i}>
                    {src.startsWith('http') ? (
                      <a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline">{src}</a>
                    ) : <span className="text-on-surface-variant">{src}</span>}
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

/* ── Dashboard Section Helpers ──────────────────────────────────────── */

function DashSection({ num, title, children }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-outline-variant pb-2">
        <span className="text-[10px] text-primary-container border border-primary-container/30 px-2 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{num}</span>
        <h2 className="text-sm font-semibold text-on-surface uppercase tracking-wide" style={{ fontFamily: 'Syne, sans-serif' }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function DashSectionDownload({ num, title, children, onDownload }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-outline-variant pb-2">
        <span className="text-[10px] text-primary-container border border-primary-container/30 px-2 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{num}</span>
        <h2 className="text-sm font-semibold text-on-surface uppercase tracking-wide flex-1" style={{ fontFamily: 'Syne, sans-serif' }}>{title}</h2>
        <button
          onClick={onDownload}
          className="text-[10px] text-on-surface-variant hover:text-primary-container border border-outline-variant hover:border-primary-container/50 px-3 py-1 rounded transition-all flex items-center gap-1 uppercase"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          <span className="material-symbols-outlined text-xs">download</span>
          .md
        </button>
      </div>
      {children}
    </div>
  )
}

function ReportDoc({ content }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded overflow-hidden">
      <div className="p-4 text-[11px] text-on-surface/80 leading-relaxed overflow-x-auto max-h-80 overflow-y-auto" style={{ fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content.split('\n').map((line, i) => (
          <div key={i}>{renderBold(line) || ' '}</div>
        ))}
      </div>
    </div>
  )
}

/* ── Agent Side Panel ───────────────────────────────────────────────── */

const STATUS_COLOR = {
  waiting:  '#5b403d',
  thinking: '#ff544c',
  complete: '#10b981',
  error:    '#ef4444',
}
const STATUS_LABEL = {
  waiting:  'STANDBY',
  thinking: 'ACTIVE',
  complete: 'DONE',
  error:    'ERROR',
}

function AgentSideCard({ name, state }) {
  const meta = AGENT_META[name]
  const findings = state.findings || []
  const topFinding = findings.length
    ? [...findings].sort((a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3))[0]
    : null
  const topSev = topFinding?.severity
  const sc = SEV_CONFIG[topSev]

  const sColor = STATUS_COLOR[state.status] || STATUS_COLOR.waiting
  const sLabel = STATUS_LABEL[state.status] || 'STANDBY'

  const cardBorder =
    state.status === 'thinking' ? 'border-primary-container/60' :
    state.status === 'complete' ? 'border-emerald-800/60' :
    state.status === 'error'    ? 'border-red-800/60' :
    'border-outline-variant/40'

  const cardBg =
    state.status === 'thinking' ? 'bg-primary-container/5' :
    state.status === 'complete' ? 'bg-emerald-950/20' :
    state.status === 'error'    ? 'bg-red-950/20' :
    'bg-surface-container-low/50'

  return (
    <div className={`p-3 rounded border transition-all duration-500 ${cardBorder} ${cardBg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm" style={{ color: sColor }}>{meta.icon}</span>
          <span className="text-[10px] text-on-surface uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {meta.label.replace(' Agent', '')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${state.status === 'thinking' ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: sColor }}
          />
          <span className="text-[9px] uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono, monospace', color: sColor }}>
            {sLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {findings.length > 0 ? `${findings.length} finding${findings.length !== 1 ? 's' : ''}` : '—'}
        </span>
        {topSev && sc && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}
          >
            {topSev}
          </span>
        )}
      </div>

      {topFinding && (
        <p className="text-[9px] text-on-surface/50 mt-1.5 leading-snug" style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>
          {topFinding.vulnerability}
        </p>
      )}

      {state.status === 'thinking' && (
        <div className="mt-2 h-0.5 bg-surface-container-highest rounded-full overflow-hidden">
          <div className="h-full bg-primary-container rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  )
}

const EVENT_META = {
  agent_start:    { icon: 'play_circle',    color: '#ff544c', label: (e) => `${AGENT_META[e.agent]?.label || e.agent} started` },
  agent_complete: { icon: 'check_circle',   color: '#10b981', label: (e) => `${AGENT_META[e.agent]?.label || e.agent} — ${e.count} finding${e.count !== 1 ? 's' : ''}` },
  agent_error:    { icon: 'error',          color: '#ef4444', label: (e) => `${AGENT_META[e.agent]?.label || e.agent} errored` },
  scoring:        { icon: 'analytics',      color: '#60a5fa', label: (e) => `Risk scored: ${e.score}/100` },
  simulating:     { icon: 'groups',         color: '#a78bfa', label: () => 'Swarm simulation started' },
  gtm_start:      { icon: 'rocket_launch',  color: '#f97316', label: () => 'GTM generation started' },
  synthesizing:   { icon: 'auto_awesome',   color: '#e879f9', label: () => 'Synthesizing report' },
  complete:       { icon: 'verified',       color: '#10b981', label: () => 'Analysis complete' },
}

function EventFeedItem({ entry }) {
  const meta = EVENT_META[entry.type] || { icon: 'info', color: '#5b403d', label: () => entry.type }
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-outline-variant/20 last:border-0">
      <span className="material-symbols-outlined text-xs mt-0.5 shrink-0" style={{ color: meta.color, fontSize: '13px' }}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-on-surface/80 leading-snug" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {meta.label(entry)}
        </p>
        <p className="text-[8px] text-on-surface-variant/50 mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {entry.ts}
        </p>
      </div>
    </div>
  )
}

function AgentSidePanel({ agents, pipelineStage, running, simProgress, step, eventLog, decisionId }) {
  const completedCount = ALL_AGENTS.filter(n => agents[n]?.status === 'complete').length
  const totalFindings  = ALL_AGENTS.reduce((acc, n) => acc + (agents[n]?.findings?.length || 0), 0)
  const feedRef = useRef(null)

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [eventLog])

  return (
    <>
      {/* ── Agent Cards Section ── */}
      <div className="flex items-center justify-between pb-2 border-b border-outline-variant/40">
        <span className="text-[10px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          LIVE AGENTS
        </span>
        <span className="text-[10px] text-primary-container" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {completedCount}/{ALL_AGENTS.length}
        </span>
      </div>

      {ALL_AGENTS.map(name => (
        <AgentSideCard key={name} name={name} state={agents[name]} />
      ))}

      {completedCount > 0 && (
        <div className="p-2.5 rounded border border-outline-variant/30 bg-surface-container-lowest/50">
          <div className="flex justify-between text-[10px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <span>TOTAL FINDINGS</span>
            <span className="text-on-surface">{totalFindings}</span>
          </div>
        </div>
      )}

      {running && pipelineStage === 'simulating' && simProgress.pct > 0 && (
        <div className="p-2.5 rounded border border-outline-variant/30 bg-surface-container-lowest/50">
          <div className="flex justify-between text-[9px] text-on-surface-variant mb-1.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <span>SWARM SIM</span>
            <span className="text-primary-container">{simProgress.pct}%</span>
          </div>
          <div className="h-0.5 bg-surface-container-highest rounded overflow-hidden">
            <div className="h-full bg-primary-container rounded transition-all duration-500" style={{ width: `${simProgress.pct}%` }} />
          </div>
          {simProgress.phase && (
            <p className="text-[9px] text-on-surface-variant/60 mt-1 truncate" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {simProgress.phase}
            </p>
          )}
        </div>
      )}

      {pipelineStage && (
        <div className="flex items-center gap-2">
          {running && <div className="thinking-dots shrink-0"><span /><span /><span /></div>}
          <span className="text-[9px] text-on-surface-variant uppercase tracking-widest truncate" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {pipelineStage.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* ── Event Feed Section ── */}
      {eventLog.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              EVENT LOG
            </span>
            <span className="text-[9px] text-on-surface-variant/50" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {eventLog.length}
            </span>
          </div>
          <div
            ref={feedRef}
            className="bg-surface-container-lowest border border-outline-variant/30 rounded px-2 py-1"
          >
            {eventLog.map(entry => (
              <EventFeedItem key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* ── Findings Graph ── */}
      {ALL_AGENTS.some(n => (agents[n]?.findings?.length || 0) > 0) && (
        <FindingsGraph agents={agents} />
      )}

    </>
  )
}

/* ── Findings Graph (D3 force) ──────────────────────────────────────── */

const SEV_NODE_COLOR = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308' }
const AGENT_NODE_COLOR = '#ff544c'

function FindingsGraph({ agents }) {
  const svgRef = useRef(null)
  const W = 256
  const H = 220

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // Build nodes and links from agent findings
    const nodes = []
    const links = []

    // Agent nodes (center cluster)
    ALL_AGENTS.forEach(name => {
      nodes.push({ id: `agent_${name}`, label: AGENT_META[name].label.replace(' Agent', ''), kind: 'agent' })
    })

    // Finding nodes
    ALL_AGENTS.forEach(name => {
      const findings = agents[name]?.findings || []
      findings.forEach((f, i) => {
        const nid = `finding_${name}_${i}`
        nodes.push({ id: nid, label: f.vulnerability?.slice(0, 28) || '?', kind: 'finding', sev: f.severity })
        links.push({ source: `agent_${name}`, target: nid })
      })
    })

    if (nodes.length === 0) return

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(40).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-60))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide(14))
      .alphaDecay(0.04)

    const g = svg.append('g')

    // Zoom
    svg.call(d3.zoom().scaleExtent([0.4, 3]).on('zoom', e => g.attr('transform', e.transform)))

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#5b403d')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)

    // Nodes
    const node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => d.kind === 'agent' ? 9 : 5)
      .attr('fill', d => d.kind === 'agent' ? AGENT_NODE_COLOR : (SEV_NODE_COLOR[d.sev] || '#60a5fa'))
      .attr('fill-opacity', d => d.kind === 'agent' ? 1 : 0.8)
      .attr('stroke', '#0e0e0e')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y })
        .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    // Labels (agent nodes only)
    const label = g.append('g')
      .selectAll('text')
      .data(nodes.filter(d => d.kind === 'agent'))
      .join('text')
      .attr('font-size', 7)
      .attr('fill', '#e5e2e1')
      .attr('text-anchor', 'middle')
      .attr('dy', 18)
      .style('pointer-events', 'none')
      .style('font-family', 'JetBrains Mono, monospace')
      .text(d => d.label.toUpperCase())

    // Tooltip on finding nodes
    node.filter(d => d.kind === 'finding')
      .append('title')
      .text(d => `[${d.sev}] ${d.label}`)

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)
      node
        .attr('cx', d => Math.max(10, Math.min(W - 10, d.x)))
        .attr('cy', d => Math.max(10, Math.min(H - 10, d.y)))
      label
        .attr('x', d => Math.max(10, Math.min(W - 10, d.x)))
        .attr('y', d => Math.max(10, Math.min(H - 10, d.y)))
    })

    return () => sim.stop()
  }, [agents])

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          FINDINGS GRAPH
        </span>
        <div className="flex items-center gap-3 text-[8px] text-on-surface-variant/60" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: AGENT_NODE_COLOR }} />agent</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-red-500" />critical</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-orange-500" />high</span>
        </div>
      </div>
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded overflow-hidden">
        <svg ref={svgRef} width={W} height={H} />
      </div>
      <p className="text-[8px] text-on-surface-variant/40 mt-1 text-center" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        scroll to zoom · drag to pan · drag nodes
      </p>
    </div>
  )
}


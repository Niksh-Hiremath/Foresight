import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import './Upload.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const STEPS = { idle: 0, uploading: 1, analyzing: 2, questions: 3, submitting: 4, done: 5 }

export default function Upload() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [step, setStep] = useState(STEPS.idle)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [decisionId, setDecisionId] = useState('')
  const [filename, setFilename] = useState('')
  const [decisionContext, setDecisionContext] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [intakeId, setIntakeId] = useState('')

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setError('')
    setStep(STEPS.uploading)
    setFilename(file.name)

    try {
      // T2.1 — upload
      const form = new FormData()
      form.append('file', file)
      const upRes = await fetch(`${API}/intake/upload`, { method: 'POST', body: form })
      if (!upRes.ok) throw new Error(`Upload failed: ${upRes.status}`)
      const { decision_id } = await upRes.json()
      setDecisionId(decision_id)

      // T2.2 — analyze
      setStep(STEPS.analyzing)
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
      setStep(STEPS.questions)
    } catch (err) {
      setError(err.message)
      setStep(STEPS.idle)
    }
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onDragOver = (e) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const onFileInput = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const handleAnswer = (id, value) => setAnswers(prev => ({ ...prev, [id]: value }))

  const submitAnswers = async () => {
    setError('')
    setStep(STEPS.submitting)
    try {
      const res = await fetch(`${API}/intake/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: decisionId, answers }),
      })
      if (!res.ok) throw new Error(`Submit failed: ${res.status}`)
      const { intake_id } = await res.json()
      setIntakeId(intake_id)
      setStep(STEPS.done)
    } catch (err) {
      setError(err.message)
      setStep(STEPS.questions)
    }
  }

  const allAnswered = questions.every(q => (answers[q.id] || '').trim() !== '')

  return (
    <div className="upload-page">
      {/* ── IDLE / DROP ZONE ── */}
      {step === STEPS.idle && (
        <>
          <div className="upload-header">
            <h1>Upload Decision Document</h1>
            <p className="upload-sub">Drop your pitch deck, business plan, or strategic memo. We'll extract context and ask targeted follow-up questions before the red-team analysis.</p>
          </div>
          <div
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-icon">📄</div>
            <p className="drop-label">Drag &amp; drop your file here</p>
            <p className="drop-hint">PDF, DOCX, or TXT · up to 20 MB</p>
            <button className="btn-primary" type="button">Browse files</button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt" onChange={onFileInput} hidden />
          </div>
          {error && <p className="upload-error">{error}</p>}
        </>
      )}

      {/* ── UPLOADING ── */}
      {step === STEPS.uploading && (
        <div className="status-card">
          <div className="spinner" />
          <h2>Uploading <span className="file-name">{filename}</span></h2>
          <p>Extracting text and indexing into RAG…</p>
        </div>
      )}

      {/* ── ANALYZING ── */}
      {step === STEPS.analyzing && (
        <div className="status-card">
          <div className="spinner" />
          <h2>Analyzing Document</h2>
          <p>Running LLM extraction — identifying decision context and gaps…</p>
        </div>
      )}

      {/* ── QUESTIONS ── */}
      {(step === STEPS.questions || step === STEPS.submitting) && decisionContext && (
        <div className="questions-view">
          <div className="context-summary">
            <h2>Decision Context Extracted</h2>
            <p className="file-badge">📄 {filename}</p>
            <div className="context-grid">
              <ContextItem label="Core Decision" value={decisionContext.core_decision} />
              <ContextItem label="Market" value={decisionContext.market} />
              <ContextItem label="Stated Beliefs" value={decisionContext.stated_beliefs} />
              <ContextItem label="Financial Posture" value={decisionContext.financial_posture} />
              <ContextItem label="Identified Gaps" value={decisionContext.gaps} highlight />
            </div>
          </div>

          <div className="followup-section">
            <h3>Follow-up Questions</h3>
            <p className="followup-sub">Answer these before we run the adversarial analysis — they target the gaps we found.</p>
            <div className="questions-list">
              {questions.map((q, i) => (
                <div key={q.id} className="question-card">
                  <p className="q-label"><span className="q-num">Q{i + 1}</span> {q.question}</p>
                  {q.type === 'mcq' ? (
                    <div className="mcq-options">
                      {(q.options || []).map(opt => (
                        <label key={opt} className={`mcq-option ${answers[q.id] === opt ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name={q.id}
                            value={opt}
                            checked={answers[q.id] === opt}
                            onChange={() => handleAnswer(q.id, opt)}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      className="text-answer"
                      rows={3}
                      placeholder="Your answer…"
                      value={answers[q.id] || ''}
                      onChange={e => handleAnswer(q.id, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
            {error && <p className="upload-error">{error}</p>}
            <button
              className="btn-primary btn-submit"
              onClick={submitAnswers}
              disabled={!allAnswered || step === STEPS.submitting}
            >
              {step === STEPS.submitting ? 'Saving…' : 'Submit Answers →'}
            </button>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {step === STEPS.done && (
        <div className="done-card">
          <div className="done-icon">✅</div>
          <h2>Context Ready</h2>
          <p>Decision context and your answers have been saved. The red-team analysis is ready to run.</p>
          <div className="done-meta">
            <span className="meta-pill">decision_id: {decisionId}</span>
          </div>
          <button
            className="btn-primary"
            onClick={() => navigate(`/dashboard?decision_id=${decisionId}`)}
          >
            Run Red Team Analysis →
          </button>
          <button className="btn-secondary" onClick={() => setStep(STEPS.idle)}>
            Upload another document
          </button>
        </div>
      )}
    </div>
  )
}

function ContextItem({ label, value, highlight }) {
  return (
    <div className={`context-item ${highlight ? 'highlight' : ''}`}>
      <p className="context-label">{label}</p>
      <p className="context-value">{value || '—'}</p>
    </div>
  )
}

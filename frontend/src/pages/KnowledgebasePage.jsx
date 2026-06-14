import { useState, useRef, useCallback, useEffect } from 'react'
import Sidebar from '../components/Sidebar'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const ACCEPTED_EXTS = ['.pdf', '.docx', '.doc', '.txt', '.csv', '.json']

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).replace(',', '')
  } catch {
    return iso
  }
}

function formatSize(chars) {
  if (chars < 1000) return `${chars} chars`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}k chars`
  return `${(chars / 1_000_000).toFixed(1)}M chars`
}

function downloadMd(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/\.[^.]+$/, '') + '.md'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function fileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  if (ext === 'pdf') return 'picture_as_pdf'
  if (ext === 'docx' || ext === 'doc') return 'description'
  if (ext === 'csv') return 'table_chart'
  if (ext === 'json') return 'data_object'
  return 'article'
}

/* ── View Modal ──────────────────────────────────────────────────────── */
function ViewModal({ doc, onClose }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-surface-container border border-outline-variant flex flex-col"
        style={{ width: '80vw', maxWidth: 960, maxHeight: '85vh' }}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant bg-surface-container-low shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary-container text-base">
              {fileIcon(doc.filename)}
            </span>
            <span className="text-[11px] text-on-surface uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {doc.filename}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => downloadMd(doc.extracted_text, doc.filename)}
              className="text-[10px] text-on-surface-variant hover:text-primary-container uppercase tracking-widest flex items-center gap-1 px-2 py-1 border border-outline-variant/50 rounded transition-colors"
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            >
              <span className="material-symbols-outlined text-xs">download</span>
              EXPORT .MD
            </button>
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5">
          <pre
            className="text-[11px] text-on-surface/80 leading-relaxed whitespace-pre-wrap break-words"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            {doc.extracted_text}
          </pre>
        </div>
      </div>
    </div>
  )
}

/* ── Delete confirm modal ────────────────────────────────────────────── */
function DeleteModal({ filename, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-surface-container border border-outline-variant p-6 flex flex-col gap-4" style={{ width: 400 }}>
        <p className="text-[11px] text-on-surface uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          CONFIRM DELETION
        </p>
        <p className="text-sm text-on-surface/70">
          Delete <span className="text-primary-container font-semibold">{filename}</span> from the knowledge base? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface px-4 py-2 border border-outline-variant/50 rounded transition-colors"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="text-[10px] uppercase tracking-widest text-white bg-red-700 hover:bg-red-600 px-4 py-2 rounded transition-colors"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            DELETE
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ───────────────────────────────────────────────────────── */
export default function KnowledgebasePage() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [viewDoc, setViewDoc] = useState(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const fileInputRef = useRef(null)

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/knowledge/`)
      if (!res.ok) throw new Error('Failed to load')
      setDocs(await res.json())
    } catch {
      /* silently fail — list stays empty */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/knowledge/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Upload failed (${res.status})`)
      }
      await fetchDocs()
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }, [fetchDocs])

  const onFileInput = e => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = e => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleView = async (doc) => {
    setViewLoading(true)
    try {
      const res = await fetch(`${API}/knowledge/${doc.id}/content`)
      const data = await res.json()
      setViewDoc(data)
    } catch {
      /* ignore */
    } finally {
      setViewLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await fetch(`${API}/knowledge/${deleteTarget.id}`, { method: 'DELETE' })
      setDocs(prev => prev.filter(d => d.id !== deleteTarget.id))
    } catch { /* ignore */ }
    setDeleteTarget(null)
  }

  return (
    <div className="bg-grid text-on-surface relative min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="fixed inset-0 pointer-events-none opacity-40 z-0 bg-grid-pattern" />
      <Sidebar />

      <main className="ml-64 pt-16 min-h-screen p-6 flex flex-col gap-8 relative z-10">

        {/* Header */}
        <div className="flex justify-between items-end border-b border-outline-variant pb-4">
          <div>
            <h1 className="font-bold text-on-surface uppercase mb-2 tracking-tighter" style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem' }}>
              KNOWLEDGE <span className="text-primary-container">BASE</span>
            </h1>
            <p className="text-[11px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              SECURE REPOSITORY // {docs.length} DOCUMENT{docs.length !== 1 ? 'S' : ''} INDEXED
            </p>
          </div>
          <div className="text-[11px] text-on-surface-variant bg-surface-container px-3 py-1 rounded border border-outline-variant/50" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            SYSTEM STATUS: <span className="text-emerald-500">NOMINAL</span>
          </div>
        </div>

        {/* Upload Zone */}
        <section className="bg-surface-container border border-outline-variant p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary-container/5 blur-3xl rounded-full pointer-events-none" />

          <div className="flex items-start justify-between mb-6 relative z-10">
            <h2 className="text-on-surface uppercase flex items-center gap-2 font-semibold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', fontSize: '1.25rem' }}>
              <span className="w-1 h-6 bg-primary-container inline-block" />
              DOCUMENT INGESTION
            </h2>
            <span className="text-[11px] text-on-surface-variant px-2 py-1 bg-surface-container-lowest border border-outline-variant/50 rounded uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {uploading ? 'PROCESSING...' : 'DROP ZONE ACTIVE'}
            </span>
          </div>

          <div
            className={`tactical-border scanline-effect relative h-52 w-full flex flex-col items-center justify-center gap-5 transition-colors cursor-pointer ${dragging ? 'border-primary-container bg-primary-container/5' : ''} ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTS.join(',')}
              className="hidden"
              onChange={onFileInput}
            />

            {uploading ? (
              <>
                <div className="thinking-dots"><span /><span /><span /></div>
                <p className="text-[11px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  EXTRACTING CONTENT...
                </p>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-4xl text-on-surface-variant">cloud_upload</span>
                <div className="text-center">
                  <p className="text-[11px] text-on-surface uppercase tracking-widest mb-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    DRAG & DROP OR CLICK TO UPLOAD
                  </p>
                  <p className="text-[10px] text-on-surface-variant tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {ACCEPTED_EXTS.map(e => e.toUpperCase()).join(' · ')}
                  </p>
                </div>
              </>
            )}
          </div>

          {uploadError && (
            <p className="mt-3 text-[11px] text-red-400 uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              ⚠ {uploadError}
            </p>
          )}
        </section>

        {/* Repository Table */}
        <section className="bg-surface-container border border-outline-variant flex-1 flex flex-col">
          <div className="p-4 border-b border-outline-variant bg-surface-container-lowest/50 flex justify-between items-center">
            <h3 className="text-[11px] text-on-surface uppercase tracking-widest flex items-center gap-2" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              <span className="material-symbols-outlined text-sm text-primary-container">folder_open</span>
              REPOSITORY ARCHIVE
            </h3>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-outline-variant bg-surface-container-low text-[11px] text-on-surface-variant uppercase tracking-wider" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <div className="col-span-5">FILENAME</div>
            <div className="col-span-3">UPLOAD DATE</div>
            <div className="col-span-2">CONTENT SIZE</div>
            <div className="col-span-2 text-right">ACTIONS</div>
          </div>

          <div className="flex flex-col flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-3 text-on-surface-variant">
                <div className="thinking-dots"><span /><span /><span /></div>
                <span className="text-[11px] uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>LOADING...</span>
              </div>
            ) : docs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
                <span className="material-symbols-outlined text-3xl">folder_open</span>
                <p className="text-[11px] uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>NO DOCUMENTS INDEXED</p>
                <p className="text-[10px] text-on-surface-variant/60 tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Upload a document above to get started</p>
              </div>
            ) : (
              docs.map(doc => (
                <div
                  key={doc.id}
                  className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-outline-variant/30 data-row transition-all items-center border-l-2 border-transparent"
                >
                  <div className="col-span-5 text-[11px] text-on-surface flex items-center gap-3 min-w-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    <span className="material-symbols-outlined text-on-surface-variant text-lg shrink-0">{fileIcon(doc.filename)}</span>
                    <span className="truncate">{doc.filename}</span>
                  </div>
                  <div className="col-span-3 text-[11px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {formatDate(doc.created_at)}
                  </div>
                  <div className="col-span-2 text-[11px] text-on-surface-variant" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {formatSize(doc.char_count)}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {/* Download */}
                    <button
                      title="Download as .md"
                      className="text-on-surface-variant hover:text-primary-container transition-colors p-1"
                      onClick={async () => {
                        const res = await fetch(`${API}/knowledge/${doc.id}/content`)
                        const data = await res.json()
                        downloadMd(data.extracted_text, doc.filename)
                      }}
                    >
                      <span className="material-symbols-outlined text-base">download</span>
                    </button>
                    {/* View */}
                    <button
                      title="View content"
                      className="text-on-surface-variant hover:text-primary-container transition-colors p-1"
                      onClick={() => handleView(doc)}
                      disabled={viewLoading}
                    >
                      <span className="material-symbols-outlined text-base">open_in_full</span>
                    </button>
                    {/* Delete */}
                    <button
                      title="Delete"
                      className="text-on-surface-variant hover:text-red-400 transition-colors p-1"
                      onClick={() => setDeleteTarget(doc)}
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {viewDoc && <ViewModal doc={viewDoc} onClose={() => setViewDoc(null)} />}
      {deleteTarget && (
        <DeleteModal
          filename={deleteTarget.filename}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

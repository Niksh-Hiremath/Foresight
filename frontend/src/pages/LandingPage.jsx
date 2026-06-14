import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

/* ── Text Scramble (same as Sidebar) ───────────────────────────────── */
class TextScramble {
  constructor(el) {
    this.el = el
    this.chars = '!<>-_\\/[]{}—=+*^?#________'
    this.queue = []
    this.frameRequest = 0
    this.frame = 0
    this.resolve = null
    this.update = this.updateFn.bind(this)
  }
  setText(newText) {
    const oldText = this.el.innerText
    const length = Math.max(oldText.length, newText.length)
    const promise = new Promise(r => (this.resolve = r))
    this.queue = []
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || ''
      const to = newText[i] || ''
      const start = Math.floor(Math.random() * 5)
      const end = start + Math.floor(Math.random() * 15)
      this.queue.push({ from, to, start, end })
    }
    cancelAnimationFrame(this.frameRequest)
    this.frame = 0
    this.update()
    return promise
  }
  updateFn() {
    let output = ''
    let complete = 0
    for (let i = 0, n = this.queue.length; i < n; i++) {
      let { from, to, start, end, char } = this.queue[i]
      if (this.frame >= end) {
        complete++
        output += to
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = this.randomChar()
          this.queue[i].char = char
        }
        output += `<span style="color:#ff544c;opacity:0.8">${char}</span>`
      } else {
        output += from
      }
    }
    this.el.innerHTML = output
    if (complete === this.queue.length) {
      this.resolve()
    } else {
      this.frameRequest = requestAnimationFrame(this.update)
      this.frame++
    }
  }
  randomChar() {
    return this.chars[Math.floor(Math.random() * this.chars.length)]
  }
}

/* ── Telemetry Widgets ─────────────────────────────────────────────── */
function TelemetryDashboard() {
  const [simulations, setSimulations] = useState(1402391)
  const [threats, setThreats] = useState(4021)
  const [barPct, setBarPct] = useState(30)

  useEffect(() => {
    const dataInterval = setInterval(() => {
      if (Math.random() > 0.5) setSimulations(p => p + Math.floor(Math.random() * 5) + 1)
      if (Math.random() > 0.8) setThreats(p => p + 1)
    }, 1500)
    const barInterval = setInterval(() => {
      setBarPct([20, 40, 25, 60, 30, 45, 55][Math.floor(Math.random() * 7)])
    }, 800)
    return () => { clearInterval(dataInterval); clearInterval(barInterval) }
  }, [])

  return (
    <div className="w-full max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 my-8 z-20 relative">
      {/* Radar */}
      <div className="bg-surface-container-lowest border border-white/5 rounded-2xl p-6 flex items-center justify-between shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-10px_rgba(0,0,0,0.5)] group relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[2px] h-full bg-primary-container/0 group-hover:bg-primary-container/80 transition-colors" style={{ boxShadow: '0 0 10px #ff544c' }} />
        <div className="flex flex-col gap-2 relative z-10">
          <div className="text-[10px] text-on-surface-variant uppercase tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Global Threat Radar</div>
          <div className="text-xl text-primary-container font-bold flex items-center gap-2 tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <span className="animate-pulse w-2 h-2 bg-primary-container rounded-full" style={{ boxShadow: '0 0 8px #ff544c' }} />
            SCANNING
          </div>
        </div>
        <div className="relative w-16 h-16 rounded-full border border-primary-container/20 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 rounded-full border border-primary-container/10 scale-75" />
          <div className="absolute inset-0 rounded-full border border-primary-container/5 scale-50" />
          <div className="w-1/2 h-1/2 absolute top-0 right-0 origin-bottom-left" style={{ background: 'linear-gradient(to top right, rgba(255,84,76,0.4), transparent)', animation: 'spin 3s linear infinite' }} />
          <div className="w-1 h-1 bg-white rounded-full z-10" style={{ boxShadow: '0 0 5px white' }} />
        </div>
      </div>

      {/* Swarm Iterations */}
      <div className="bg-surface-container-lowest border border-white/5 rounded-2xl p-6 flex flex-col justify-center gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-10px_rgba(0,0,0,0.5)] group relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[2px] h-full bg-primary-container/0 group-hover:bg-primary-container/80 transition-colors" style={{ boxShadow: '0 0 10px #ff544c' }} />
        <div className="flex justify-between items-end relative z-10">
          <div className="flex flex-col gap-1">
            <div className="text-[10px] text-on-surface-variant uppercase tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Swarm Iterations</div>
            <div className="text-2xl text-on-surface font-bold tracking-tight" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{simulations.toLocaleString()}</div>
          </div>
        </div>
        <div className="w-full h-px bg-white/5 relative z-10">
          <div className="h-full bg-primary-container transition-all duration-700" style={{ width: `${barPct}%` }} />
        </div>
        <div className="flex justify-between items-end relative z-10 mt-1">
          <div className="text-[10px] text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Threats Mitigated</div>
          <div className="text-sm text-primary-container font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{threats.toLocaleString()}</div>
        </div>
      </div>

      {/* Cluster Status */}
      <div className="bg-surface-container-lowest border border-white/5 rounded-2xl p-6 flex items-center justify-between shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_40px_-10px_rgba(0,0,0,0.5)] group relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[2px] h-full bg-primary-container/0 group-hover:bg-primary-container/80 transition-colors" style={{ boxShadow: '0 0 10px #ff544c' }} />
        <div className="flex flex-col gap-2 relative z-10">
          <div className="text-[10px] text-on-surface-variant uppercase tracking-[0.2em]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Cluster Status</div>
          <div className="text-xl text-on-surface font-bold tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace' }}>OPTIMAL</div>
          <div className="text-[10px] text-emerald-400 uppercase tracking-widest flex items-center gap-1 mt-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <span className="material-symbols-outlined text-xs">check_circle</span> 12 Nodes Active
          </div>
        </div>
        <NodeGrid />
      </div>
    </div>
  )
}

function NodeGrid() {
  const [opacities] = useState(() => Array.from({ length: 9 }, () => Math.random()))
  return (
    <div className="grid grid-cols-3 gap-1.5 opacity-80">
      {opacities.map((o, i) => (
        <div key={i} className="w-2.5 h-2.5 rounded-sm bg-emerald-500 animate-pulse" style={{ animationDelay: `${o * 2}s`, animationDuration: `${2 + o * 2}s` }} />
      ))}
    </div>
  )
}

/* ── Feature Carousel (CSS-based, no Swiper) ───────────────────────── */
function GeminiVis() {
  const [text, setText] = useState('')
  const full = '> INGESTING GLOBAL MARKET DATA...\n> APPLYING ADVERSARIAL WEIGHTS...\n> SYNTHESIZING GTM PROTOCOL...\n> KINETIC ASSETS READY.'
  useEffect(() => {
    let i = 0
    const iv = setInterval(() => { setText(full.slice(0, i)); i++; if (i > full.length) clearInterval(iv) }, 30)
    return () => clearInterval(iv)
  }, [])
  return (
    <div className="relative w-full h-64 flex flex-col justify-start overflow-hidden rounded-t-3xl p-8 text-left" style={{ background: '#0a0a0a', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 mb-6">
        <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
        <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
        <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
      </div>
      <pre className="text-sm text-primary-container/90 whitespace-pre-wrap leading-relaxed" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {text}<span className="animate-pulse opacity-70">_</span>
      </pre>
      {/* <div className="absolute bottom-6 right-6 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full backdrop-blur-md" style={{ background: 'linear-gradient(to right, rgba(59,130,246,0.2), rgba(168,85,247,0.2))', border: '1px solid rgba(168,85,247,0.3)', color: 'white' }}>
        <span className="material-symbols-outlined text-purple-400" style={{ fontSize: '14px' }}>auto_awesome</span>
        POWERED BY GEMINI
      </div> */}
    </div>
  )
}

const FEATURES = [
  {
    title: '5-Agent Assessment',
    desc: 'Multi-agent cognitive swarm pulling from real-time web streams and deep knowledge bases to triangulate absolute truth.',
    visual: () => (
      <div className="relative w-full h-64 flex items-center justify-center overflow-hidden rounded-t-3xl tactical-grid" style={{ background: 'linear-gradient(to bottom, #0e0e0e, #131313)' }}>
        <div className="relative w-20 h-20 rounded-full flex items-center justify-center z-10" style={{ background: 'rgba(255,84,76,0.1)', border: '1px solid rgba(255,84,76,0.5)', boxShadow: '0 0 30px rgba(255,84,76,0.3)' }}>
          <div className="w-12 h-12 rounded-full bg-primary-container flex items-center justify-center animate-pulse" style={{ boxShadow: '0 0 15px #ff544c' }}>
            <span className="material-symbols-outlined text-white text-2xl">hub</span>
          </div>
        </div>
        {[0, 72, 144, 216, 288].map((deg, i) => (
          <div key={i} className="absolute w-full h-full flex items-center justify-center pointer-events-none" style={{ animation: `spin ${20 + i * 2}s linear infinite`, transform: `rotate(${deg}deg)` }}>
            <div className="absolute w-3 h-3 bg-white rounded-full" style={{ top: '18%', boxShadow: '0 0 12px white' }} />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Swarm-Intelligence Theory',
    desc: 'Run millions of permutations into the future. Expose vulnerabilities before they manifest and map the optimal path to victory.',
    visual: () => (
      <div className="relative w-full h-64 flex items-end overflow-hidden rounded-t-3xl" style={{ background: 'linear-gradient(to bottom, #0e0e0e, #131313)' }}>
        <div className="absolute inset-0 scanlines opacity-20 pointer-events-none" />
        <svg className="w-full h-full absolute inset-0" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path d="M0,90 Q15,85 30,60 T60,50 T100,70" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <path d="M0,90 Q25,60 50,70 T80,30 T100,10" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <path d="M0,90 Q10,70 35,40 T75,60 T100,90" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <path d="M0,90 Q20,50 45,20 T70,40 T100,30" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <path d="M0,90 Q20,70 40,50 T70,30 T100,20" fill="none" stroke="#ff544c" strokeWidth="2.5" className="path-draw" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 8px rgba(255,84,76,0.8))' }} />
        </svg>
        <div className="absolute top-6 right-6 flex items-center gap-2 text-primary-container text-[11px] px-3 py-1.5 rounded-full" style={{ fontFamily: 'JetBrains Mono, monospace', background: 'rgba(32,31,31,0.8)', border: '1px solid rgba(255,84,76,0.3)', boxShadow: '0 0 15px rgba(255,84,76,0.2)' }}>
          <div className="w-2 h-2 rounded-full bg-primary-container animate-pulse" />
          OPTIMAL VECTOR LOCKED
        </div>
      </div>
    ),
  },
  {
    title: 'GTM Generation',
    desc: 'Zero-latency Go-To-Market strategy formulation. Turn raw intelligence into deployable kinetic marketing assets instantly.',
    visual: GeminiVis,
  },
]

function FeatureCarousel() {
  const [active, setActive] = useState(1)

  return (
    <div className="w-full max-w-4xl mx-auto px-4">
      {/* Fixed-height stage so absolutely-positioned cards don't bleed into adjacent sections */}
      <div className="relative" style={{ height: 560 }}>
        {FEATURES.map((f, i) => {
          const offset = i - active
          const isActive = offset === 0
          const scale = isActive ? 1 : 0.82
          const opacity = Math.abs(offset) > 1 ? 0 : isActive ? 1 : 0.6
          const zIndex = isActive ? 10 : 1
          return (
            <div
              key={i}
              onClick={() => setActive(i)}
              className="absolute top-8 flex flex-col overflow-hidden cursor-pointer"
              style={{
                width: 380,
                left: '50%',
                borderRadius: 24,
                background: 'var(--color-surface-container)',
                border: isActive ? '1px solid rgba(255,84,76,0.3)' : '1px solid rgba(255,255,255,0.05)',
                boxShadow: isActive
                  ? '0 30px 60px -15px rgba(255,84,76,0.15), inset 0 1px 0 rgba(255,255,255,0.15)'
                  : '0 20px 40px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
                transform: `translateX(calc(-50% + ${offset * 320}px)) scale(${scale})`,
                opacity,
                zIndex,
                transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <f.visual />
              <div className="p-8 flex flex-col gap-4" style={{ background: 'var(--color-surface-container)' }}>
                <h3 className="font-bold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', fontSize: '1.5rem', color: isActive ? '#ff544c' : '#e5e2e1', transition: 'color 0.5s' }}>
                  {f.title}
                </h3>
                <p className="text-lg leading-relaxed text-on-surface-variant">{f.desc}</p>
              </div>
            </div>
          )
        })}
      </div>
      {/* Pagination dots */}
      <div className="flex items-center justify-center gap-3 mt-4">
        {FEATURES.map((_, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === active ? 24 : 10,
              height: 10,
              background: i === active ? '#ff544c' : '#5b403d',
              boxShadow: i === active ? '0 0 10px #ff544c' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Main Landing Page ─────────────────────────────────────────────── */
export default function LandingPage() {
  const scrambleRef = useRef(null)
  const [isGlitching, setIsGlitching] = useState(false)

  useEffect(() => {
    if (!scrambleRef.current) return
    const fx = new TextScramble(scrambleRef.current)
    let timer = null
    let sequenceActive = false

    const runSequence = async () => {
      if (sequenceActive) return
      sequenceActive = true
      clearTimeout(timer)
      await fx.setText('PAST')
      await new Promise(r => setTimeout(r, 100))
      await fx.setText('PRESENT')
      await new Promise(r => setTimeout(r, 100))
      await fx.setText('FUTURE')
      await new Promise(r => setTimeout(r, 100))
      await fx.setText('FORESIGHT')
      sequenceActive = false
      timer = setTimeout(() => { if (!sequenceActive) fx.setText('FORESIGHT') }, 8000)
    }

    runSequence()
    const el = scrambleRef.current
    const onEnter = () => runSequence()
    el.addEventListener('mouseenter', onEnter)
    return () => { clearTimeout(timer); el.removeEventListener('mouseenter', onEnter) }
  }, [])

  // Periodic glitch
  useEffect(() => {
    const iv = setInterval(() => {
      setIsGlitching(true)
      setTimeout(() => setIsGlitching(false), 1000)
    }, 8000)
    return () => clearInterval(iv)
  }, [])

  // Scroll parallax on hero
  useEffect(() => {
    const onScroll = () => {
      const el = document.getElementById('hero-content')
      if (!el) return
      const scrollY = window.scrollY
      el.style.transform = `scale(${Math.max(0.8, 1 - scrollY / 2000)})`
      el.style.opacity = Math.max(0, 1 - scrollY / 500).toString()
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Intersection observer for fade-in sections
  useEffect(() => {
    const obs = new IntersectionObserver((entries, o) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); o.unobserve(e.target) }
      })
    }, { threshold: 0.15 })
    document.querySelectorAll('.fade-in-section').forEach(s => { s.classList.add('fade-in-up'); obs.observe(s) })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="bg-background text-on-surface min-h-screen flex flex-col relative overflow-x-hidden" style={{ fontFamily: 'Inter, sans-serif', userSelect: 'none' }}>
      {/* Tactical grid + scanlines */}
      <div className="fixed inset-0 pointer-events-none tactical-grid -z-10" />
      <div className="fixed inset-0 pointer-events-none scanlines -z-10 opacity-30" />

      {/* ── Header ── */}
      <header className="w-full top-0 sticky bg-background/90 backdrop-blur-md border-b border-outline-variant flex justify-between items-center px-16 py-4 z-50">
        <div className="flex items-center gap-8">
          <div
            ref={scrambleRef}
            className="font-bold tracking-tighter text-primary uppercase cursor-pointer hover:opacity-80 transition-opacity min-w-[150px]"
            style={{ fontFamily: 'Syne, sans-serif', fontSize: '1.25rem' }}
          >
            FORESIGHT
          </div>
          <nav className="hidden md:flex gap-6 items-center">
            {['About Us', 'Features', 'Partner'].map(label => (
              <a key={label} href="#" className="text-on-surface-variant hover:text-on-surface transition-colors hover:bg-surface-container-highest px-2 py-1 rounded active:opacity-80 duration-150" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                {label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/agents" className="border border-outline-variant text-on-surface px-6 py-2 rounded hover:bg-surface-container-highest transition-all uppercase tracking-widest text-center" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
            Log In
          </Link>
          <button className="bg-primary-container text-on-primary-container px-6 py-2 rounded hover:bg-primary transition-all uppercase tracking-widest border border-primary-container" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', boxShadow: '0 0 8px #ff544c' }}>
            Sign Up
          </button>
        </div>
      </header>

      {/* ── Ticker ── */}
      <div className="w-full border-y border-primary-container/40 ticker-wrap py-1.5 my-6 relative overflow-hidden" style={{ background: 'rgba(255,84,76,0.05)' }}>
        <div className="ticker-content font-bold whitespace-nowrap flex items-center gap-8 px-4" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem', color: '#ff544c', letterSpacing: '0.25em', animationDuration: '8s', animationDirection: 'reverse' }}>
          {['[ RISK DETECTED ]', '[ THREAT INCOMING ]', '[ VERDICT PENDING ]', '[ DECISION REQUIRED ]', '[ STRATEGY OPTIMAL ]', '[ SYSTEM NOMINAL ]',
            '[ RISK DETECTED ]', '[ THREAT INCOMING ]', '[ VERDICT PENDING ]', '[ DECISION REQUIRED ]', '[ STRATEGY OPTIMAL ]', '[ SYSTEM NOMINAL ]'].map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <main className="flex-grow flex flex-col items-center w-full max-w-[1440px] mx-auto px-6 md:px-16 pt-12 pb-48 relative">
        {/* Parallax radial glows */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none -z-10" style={{ background: 'radial-gradient(circle at center, rgba(255,84,76,0.05) 0%, transparent 70%)' }} />

        {/* ── Hero ── */}
        <section className="w-full flex flex-col items-center text-center min-h-[50vh] gap-8 mb-16 relative pt-10">
          <div className="max-w-6xl w-full flex flex-col gap-16 z-10" id="hero-content" style={{ transition: 'transform 0.5s ease-out, opacity 0.5s ease-out' }}>
            <div className="relative inline-block w-full text-center">
              <h1
                className={`font-bold leading-[1.1] tracking-tighter glitch-text ${isGlitching ? 'is-glitching' : ''}`}
                data-text="NEVER LOSE A MOVE."
                style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(3rem, 10vw, 7rem)', color: '#e5e2e1' }}
              >
                NEVER LOSE A{' '}
                <span className="inline-block text-white px-6 py-2 ml-2" style={{ background: '#ff544c' }}>MOVE.</span>
              </h1>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center md:items-start w-full gap-10 mt-4 text-left">
              <div className="max-w-xl">
                <p className="text-lg text-secondary leading-relaxed" style={{ color: '#c8c6c5' }}>
                  Adversarial AI for high-stakes decisions. Save strategies, market intelligence, competitor moves, and forecasts in one private simulation engine. Synthesize them later to ensure victory, not just where you left them.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
                <Link to="/agents" className="bg-primary-container text-on-primary-container px-8 py-4 rounded-full flex items-center gap-3 uppercase tracking-widest hover:bg-[#bb171c] transition-colors font-bold group" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', boxShadow: '0 0 20px rgba(255,84,76,0.3)' }}>
                  Start Simulation
                  <span className="material-symbols-outlined group-hover:translate-x-2 transition-transform">arrow_forward</span>
                </Link>
                <button className="border border-outline-variant text-on-surface px-8 py-4 rounded-full hover:bg-surface-container-highest transition-all uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                  See how it works
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Telemetry ── */}
        <TelemetryDashboard />

        {/* ── Feature Carousel ── */}
        <section className="w-full max-w-5xl my-16 relative z-20">
          <FeatureCarousel />
        </section>

        {/* ── Three Phases ── */}
        <section className="w-full grid grid-cols-1 md:grid-cols-3 gap-0 border-y border-outline-variant my-16 fade-in-section">
          {[
            { phase: 'PHASE 01', title: 'Interrogate', desc: 'Extract raw intelligence from fragmented global data streams. Our engines parse unstructured noise into actionable semantic vectors.', active: false },
            { phase: 'PHASE 02', title: 'Simulate',    desc: 'Deploy adversarial models against your current positioning. Stress-test assumptions through million-iteration Monte Carlo branches.', active: true },
            { phase: 'PHASE 03', title: 'Strategize',  desc: 'Synthesize winning pathways. Generate robust, counter-intuitive strategies optimized for maximum alpha and minimum exposure.', active: false },
          ].map((p, i) => (
            <div key={i} className={`flex flex-col border-b md:border-b-0 ${i < 2 ? 'md:border-r' : ''} border-outline-variant p-10 hover:bg-surface-container-lowest transition-colors relative group h-full`}>
              <div className={`absolute top-0 left-0 w-full h-[3px] ${p.active ? 'bg-primary-container scale-x-100' : 'bg-primary-container scale-x-0 group-hover:scale-x-100'} origin-left transition-transform duration-300`} style={p.active ? { boxShadow: '0 0 15px rgba(255,84,76,0.6)' } : {}} />
              <div className="flex items-center gap-4 mb-8">
                <span
                  className="text-[11px] px-3 py-1 rounded-sm"
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    color: p.active ? '#201f1f' : '#ff544c',
                    background: p.active ? '#ff544c' : 'var(--color-surface-variant)',
                    border: p.active ? 'none' : '1px solid rgba(255,84,76,0.3)',
                    boxShadow: p.active ? '0 0 10px rgba(255,84,76,0.4)' : 'none',
                    fontWeight: 'bold',
                  }}
                >
                  {p.phase}
                </span>
                <h3 className="text-lg text-on-surface uppercase tracking-widest font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: p.active ? '#ff544c' : '#e5e2e1' }}>
                  {p.title}
                </h3>
              </div>
              <p className="text-lg leading-relaxed" style={{ color: p.active ? '#e5e2e1' : '#e4beb9' }}>{p.desc}</p>
            </div>
          ))}
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="w-full border-t border-outline-variant py-20 px-16 z-10 relative mt-auto" style={{ background: '#0e0e0e' }}>
        <div className="max-w-[1440px] mx-auto flex flex-col gap-16">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-10">
            <div className="flex flex-col gap-6">
              <div className="font-bold tracking-tighter text-on-surface uppercase" style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem' }}>FORESIGHT</div>
              <p className="text-on-surface-variant max-w-sm uppercase tracking-widest leading-loose" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                Tactical Intelligence &amp; Strategic Simulation Systems
              </p>
            </div>
            <nav className="grid grid-cols-2 gap-x-16 gap-y-6">
              {['Privacy Policy', 'Terminal Terms', 'End User Agreement', 'Contact Secure'].map(l => (
                <a key={l} href="#" className="text-on-surface-variant hover:text-primary-container transition-all duration-300 uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                  {l}
                </a>
              ))}
            </nav>
          </div>
          <div className="pt-12 border-t border-outline-variant flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-on-surface-variant uppercase tracking-widest" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem' }}>
              © 2024 FORESIGHT STRATEGIC SYSTEMS. ALL RIGHTS RESERVED. CLASSIFIED.
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-primary-container animate-pulse" style={{ boxShadow: '0 0 12px #ff544c' }} />
              <span className="text-primary-container uppercase tracking-widest font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem' }}>
                System Status: Operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

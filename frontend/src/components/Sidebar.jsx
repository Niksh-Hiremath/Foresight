import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'

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
    const promise = new Promise(resolve => (this.resolve = resolve))
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

const navItems = [
  { icon: 'smart_toy', label: 'Agents', path: '/agents' },
  { icon: 'database', label: 'Knowledge Base', path: '/knowledge-base' },
  { icon: 'extension', label: 'Plugins', path: '/plugins' },
  { icon: 'history', label: 'History', path: '/history' },
]

export default function Sidebar() {
  const location = useLocation()
  const scrambleRef = useRef(null)

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
      timer = setTimeout(() => {
        if (!sequenceActive) fx.setText('FORESIGHT')
      }, 8000)
    }

    runSequence()

    const el = scrambleRef.current
    const onEnter = () => runSequence()
    el.addEventListener('mouseenter', onEnter)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('mouseenter', onEnter)
    }
  }, [])

  return (
    <nav className="bg-surface-container-low text-primary fixed left-0 top-0 h-screen w-64 border-r border-outline-variant z-40 flex flex-col pt-10 transition-all duration-300 ease-in-out overflow-y-auto">
      {/* Header */}
      <div className="px-6 mb-8 flex items-center gap-4">
        <div>
          <h2
            ref={scrambleRef}
            className="text-xl font-bold tracking-tighter text-on-surface uppercase cursor-pointer hover:opacity-80 transition-opacity"
            style={{ fontFamily: 'Syne, sans-serif' }}
          >
            FORESIGHT
          </h2>
        </div>
      </div>

      {/* Main Navigation */}
      <ul className="flex flex-col flex-grow">
        {navItems.map(item => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/')
          return (
            <li key={item.label}>
              <Link
                to={item.path}
                className={cn(
                  'flex items-center gap-4 px-6 py-4 transition-all duration-300 ease-in-out border-l-2 group',
                  isActive
                    ? 'bg-secondary-container text-on-surface border-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant border-transparent'
                )}
              >
                <span className="material-symbols-outlined text-base group-hover:scale-110 transition-transform">
                  {item.icon}
                </span>
                <span className="text-[11px] tracking-widest uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {item.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Footer */}
      <div className="mt-auto pb-6">
        <ul className="flex flex-col mb-6 border-t border-outline-variant pt-4">
          <li>
            <Link to="/support" className="flex items-center gap-4 px-6 py-3 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-all duration-300 group">
              <span className="material-symbols-outlined text-sm group-hover:scale-110 transition-transform">help</span>
              <span className="text-[11px] tracking-widest uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Support</span>
            </Link>
          </li>
          <li>
            <Link to="/settings" className="flex items-center gap-4 px-6 py-3 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-all duration-300 group">
              <span className="material-symbols-outlined text-sm group-hover:scale-110 transition-transform">settings</span>
              <span className="text-[11px] tracking-widest uppercase" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Settings</span>
            </Link>
          </li>
        </ul>
        <div className="px-6 pt-2">
          <div className="flex items-center gap-4 p-3 rounded bg-surface-container border border-outline-variant hover:border-primary-container/50 transition-colors cursor-pointer group">
            <div className="w-10 h-10 rounded bg-surface-variant flex items-center justify-center border border-outline-variant group-hover:border-primary-container/50 transition-colors">
              <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors text-base">account_circle</span>
            </div>
            <div className="flex flex-col flex-grow overflow-hidden">
              <span className="text-[11px] text-on-surface tracking-widest uppercase truncate" style={{ fontFamily: 'JetBrains Mono, monospace' }}>GUEST OPERATIVE</span>
              <span className="text-[10px] text-on-surface-variant/60 tracking-widest truncate" style={{ fontFamily: 'JetBrains Mono, monospace' }}>ID: 884-A9B</span>
            </div>
            <span className="material-symbols-outlined text-on-surface-variant text-sm group-hover:text-primary transition-colors">more_vert</span>
          </div>
        </div>
      </div>
    </nav>
  )
}

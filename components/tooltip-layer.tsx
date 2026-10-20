'use client'
// One tooltip for the whole panel: on hover or keyboard focus it explains icon-only buttons and links (their title,
// else their label) and anything marked data-tip (the menu says what each page is for). The browser's own slow
// title tooltip is held back while ours shows. Fixed position, so scrolling tables and the sidebar do not clip it.
import { useEffect, useState } from 'react'

const TARGET = '[data-tip], .icon-only, .icon-button, table a[title], table button[title]'
type Tip = { text: string; x: number; y: number; side: 'right' | 'top' | 'bottom' }

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  useEffect(() => {
    let current: HTMLElement | null = null
    const hide = () => {
      if (current?.dataset.tipTitle !== undefined) { current.setAttribute('title', current.dataset.tipTitle); delete current.dataset.tipTitle }
      current = null
      setTip(null)
    }
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(TARGET) as HTMLElement | null
      if (el === current) return
      hide()
      if (!el || el.closest('.sidebar-open')) return // the phone drawer: no hover, and no room beside it
      const text = el.dataset.tip || el.getAttribute('title') || el.getAttribute('aria-label')
      if (!text) return
      if (el.hasAttribute('title')) { el.dataset.tipTitle = el.getAttribute('title')!; el.removeAttribute('title') }
      current = el
      const r = el.getBoundingClientRect()
      if (el.dataset.tipSide === 'right') return setTip({ text, x: r.right + 10, y: r.top + r.height / 2, side: 'right' })
      const x = Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140)
      setTip(r.top > 70 ? { text, x, y: r.top - 8, side: 'top' } : { text, x, y: r.bottom + 8, side: 'bottom' })
    }
    const out = (e: MouseEvent) => { if (current && !current.contains(e.relatedTarget as Node | null)) hide() }
    const focus = (e: FocusEvent) => { if ((e.target as Element).matches?.(':focus-visible')) show(e) }
    document.addEventListener('mouseover', show)
    document.addEventListener('mouseout', out)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('mousedown', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      hide()
      document.removeEventListener('mouseover', show)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('mousedown', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])
  if (!tip) return null
  return <div className={`ui-tip ui-tip-${tip.side}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
}

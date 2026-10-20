'use client'
// "Go back": to the page before, or home when there is none (a link opened in a new tab).
import { ArrowLeft } from 'lucide-react'

export function BackButton({ label = 'Go back' }: { label?: string }) {
  return (
    <button type="button" className="button secondary" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign('/'))}>
      <ArrowLeft size={16} /> {label}
    </button>
  )
}

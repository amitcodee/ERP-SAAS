'use client'
// A list typed as chips: type one item, press Enter (or comma) and it becomes a chip; × or Backspace removes one.
// The value is kept as plain text, one item per comma: "A, B, C" (letters add the "and" when they print {{skills}}).
import { useState } from 'react'
import { X } from 'lucide-react'

/** "A, B, C" -> ['A', 'B', 'C']: one chip per comma, so "Research and Development" stays one chip. */
export function splitChips(text: string | null | undefined): string[] {
  return (text ?? '').split(',').map((p) => p.trim()).filter(Boolean)
}

/** ['A', 'B', 'C'] -> "A, B, C". */
export const joinChips = (items: string[]) => items.join(', ')

export function ChipInput({ value, onChange, name, placeholder, label }: {
  value: string; onChange: (v: string) => void; name?: string; placeholder?: string; label: string
}) {
  const chips = splitChips(value)
  const [text, setText] = useState('')
  const set = (items: string[]) => onChange(joinChips(items))
  const add = (raw: string) => {
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
    const fresh = items.filter((s) => !chips.some((c) => c.toLowerCase() === s.toLowerCase()))
    if (fresh.length) set([...chips, ...fresh])
    setText('')
  }
  return (
    <div className="chip-input" onClick={(e) => (e.currentTarget.querySelector('input:not([type=hidden])') as HTMLInputElement | null)?.focus()}>
      {chips.map((c) => (
        <span key={c} className="chip">{c}<button type="button" aria-label={`Remove ${c}`} onClick={() => set(chips.filter((x) => x !== c))}><X size={12} /></button></span>
      ))}
      <input
        value={text} aria-label={label} placeholder={chips.length ? 'Add another…' : placeholder}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) add(text) }
          else if (e.key === 'Backspace' && !text && chips.length) set(chips.slice(0, -1))
        }}
        onBlur={() => text.trim() && add(text)}
      />
      {/* for plain forms: what is saved, including a last item typed but not yet turned into a chip */}
      {name && <input type="hidden" name={name} value={joinChips(text.trim() ? [...chips, text.trim()] : chips)} />}
    </div>
  )
}

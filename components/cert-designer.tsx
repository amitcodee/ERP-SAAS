'use client'
// The certificate canvas (Certificate Designs → New / Edit). Left: what to add (text and the participant's details,
// shapes, pictures from the computer or a link on the internet, the QR code, the logo) and the page. Middle: the A4
// page; click to select, drag to move, pull the handles to resize, arrows to nudge. Right: the selected item's look,
// and the layers. Ctrl+Z / Ctrl+Y undo and redo, Ctrl+D duplicates, Delete removes. Saved designs are used by events.
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Circle, Copy, Eye, EyeOff, Hexagon, Image as ImageIcon, Link2, Lock,
  Minus, QrCode, Redo2, Save, Square, Trash2, Triangle, Type, Undo2, Unlock, Upload, X,
} from 'lucide-react'
import { fetchDesignImageAction } from '@/app/event-actions'
import { useNotify } from '@/components/panel-shell'
import { DESIGN_FONT_CSS, DesignSvg, ElDrawing, measure, useDesignFonts } from '@/components/cert-design-svg'
import { useBrand } from '@/components/brand-context'
import {
  BRAND_LOGO, SIGN_AUTHORISED, SIGN_HEAD, DESIGN_FIELDS, FONT_KEYS, FONT_LABEL, PRESETS, SAMPLE_VALUES, fillDesignText, layoutText, newElId, pageSize, presetDesign,
  type Align, type Design, type DesignEl, type DesignField,
} from '@/lib/cert-design'

type El = DesignEl
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2'
type Drag = { kind: 'move' | Handle; id: string; start: { x: number; y: number }; orig: El }
const r1 = (n: number) => Math.round(n * 10) / 10
const LABEL: Record<El['t'], string> = { text: 'Text', rect: 'Rectangle', ellipse: 'Circle', poly: 'Shape', line: 'Line', image: 'Picture', qr: 'QR code' }
const elName = (e: El) => (e.t === 'text' ? e.text.replace(/\s+/g, ' ').slice(0, 28) || 'Text' : e.t === 'poly' ? ({ 3: 'Triangle', 4: 'Diamond', 5: 'Pentagon', 6: 'Hexagon', 8: 'Octagon', 12: 'Badge' } as Record<number, string>)[e.sides] ?? `${e.sides}-sided shape` : LABEL[e.t])

/** The box drawn around an element when selected (text: from the top of its letters). */
function bounds(e: El) {
  if (e.t === 'line') return { x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h) }
  if (e.t === 'text') return { x: e.x, y: e.y - e.size * 0.82, w: e.w, h: Math.max(e.h, e.size) }
  return { x: e.x, y: e.y, w: e.w, h: e.h }
}

/** A picture as PNG (when it may be see-through) or JPEG, at most 2400 px across: what the PDF can hold. */
async function printable(dataUrl: string): Promise<{ src: string; ratio: number }> {
  const img = new window.Image()
  img.src = dataUrl
  await img.decode()
  const w0 = img.naturalWidth || 800, h0 = img.naturalHeight || 600
  const k = Math.min(1, 2400 / Math.max(w0, h0))
  if (k === 1 && /^data:image\/(png|jpeg);/.test(dataUrl) && dataUrl.length < 2_500_000) return { src: dataUrl, ratio: w0 / h0 }
  const c = document.createElement('canvas')
  c.width = Math.round(w0 * k); c.height = Math.round(h0 * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const alpha = !/^data:image\/jpeg/.test(dataUrl)
  return { src: alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9), ratio: w0 / h0 }
}
const readFile = (f: File) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(f) })

export function CertDesigner({ id, initialName, initial, readOnly }: { id: string | null; initialName: string; initial: Design; readOnly?: boolean }) {
  const brand = useBrand()
  const router = useRouter()
  const notify = useNotify()
  const fonts = useDesignFonts()
  const [name, setName] = useState(initialName)
  const [design, setDesign] = useState<Design>(initial)
  const [sel, setSel] = useState<string | null>(null)
  const [past, setPast] = useState<Design[]>([])
  const [future, setFuture] = useState<Design[]>([])
  const [sample, setSample] = useState(true)
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const [dirty, setDirty] = useState(false)
  const [saving, startSave] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [linkFor, setLinkFor] = useState<'image' | 'background' | null>(null)
  const [pick, setPick] = useState<'image' | 'background' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const { W, H } = pageSize(design)
  const selected = design.els.find((e) => e.id === sel) ?? null

  // every change goes through here; `record` false while a drag is under way (the drag recorded its start)
  const change = useCallback((next: Design | ((d: Design) => Design), record = true) => {
    setDesign((cur) => {
      const n = typeof next === 'function' ? next(cur) : next
      if (record) { setPast((p) => [...p.slice(-99), cur]); setFuture([]) }
      return n
    })
    setDirty(true)
  }, [])
  const patch = useCallback((id: string, p: Partial<El>, record = true) => change((d) => ({ ...d, els: d.els.map((e) => (e.id === id ? ({ ...e, ...p } as El) : e)) }), record), [change])
  const undo = () => { if (!past.length) return; setFuture((f) => [design, ...f]); setDesign(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setDirty(true) }
  const redo = () => { if (!future.length) return; setPast((p) => [...p, design]); setDesign(future[0]); setFuture((f) => f.slice(1)); setDirty(true) }
  const add = (e: Omit<El, 'id'>, atBack = false) => {
    const el = { ...e, id: newElId(design) } as El
    change((d) => ({ ...d, els: atBack ? [el, ...d.els] : [...d.els, el] }))
    setSel(el.id)
  }
  const remove = (id: string) => { change((d) => ({ ...d, els: d.els.filter((e) => e.id !== id) })); setSel(null) }
  const duplicate = (id: string) => {
    const e = design.els.find((x) => x.id === id)
    if (!e) return
    const copy = { ...e, id: newElId(design), x: e.x + 4, y: e.y + 4, locked: false } as El
    change((d) => { const i = d.els.findIndex((x) => x.id === id); const els = [...d.els]; els.splice(i + 1, 0, copy); return { ...d, els } })
    setSel(copy.id)
  }
  const reorder = (id: string, to: 'up' | 'down' | 'top' | 'bottom') => change((d) => {
    const i = d.els.findIndex((x) => x.id === id), els = [...d.els], [e] = els.splice(i, 1)
    const j = to === 'top' ? els.length : to === 'bottom' ? 0 : to === 'up' ? Math.min(els.length, i + 1) : Math.max(0, i - 1)
    els.splice(j, 0, e)
    return { ...d, els }
  })

  // ---- the keyboard ----
  useEffect(() => {
    if (readOnly) return
    const onKey = (ev: KeyboardEvent) => {
      const typing = ev.target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable)
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return }
      if (mod && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); redo(); return }
      if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); return }
      if (typing || !selected) return
      if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicate(selected.id); return }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); remove(selected.id); return }
      if (ev.key === 'Escape') { setSel(null); return }
      const step = ev.shiftKey ? 5 : 0.5
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key]
      if (mv && !selected.locked) { ev.preventDefault(); patch(selected.id, { x: r1(selected.x + mv[0]), y: r1(selected.y + mv[1]) }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // a warning before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [dirty])

  // ---- dragging on the canvas ----
  const toMm = (ev: { clientX: number; clientY: number }) => {
    const m = svgRef.current?.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  const startDrag = (ev: React.PointerEvent, e: El, kind: Drag['kind']) => {
    if (readOnly) return
    ev.stopPropagation()
    setSel(e.id)
    if (e.locked && kind === 'move') return
    ;(ev.target as Element).setPointerCapture?.(ev.pointerId)
    drag.current = { kind, id: e.id, start: toMm(ev), orig: e }
    setPast((p) => [...p.slice(-99), design]); setFuture([])
  }
  const onMove = (ev: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toMm(ev), dx = p.x - d.start.x, dy = p.y - d.start.y, o = d.orig
    if (d.kind === 'move') {
      let x = r1(o.x + dx), y = r1(o.y + dy)
      // snap the middle of the item to the middle of the page
      const b = bounds({ ...o, x, y } as El)
      const v = Math.abs(b.x + b.w / 2 - W / 2) < 1.5, h = Math.abs(b.y + b.h / 2 - H / 2) < 1.5
      if (v) x = r1(x + (W / 2 - (b.x + b.w / 2)))
      if (h) y = r1(y + (H / 2 - (b.y + b.h / 2)))
      setGuides({ v, h })
      patch(d.id, { x, y }, false)
      return
    }
    if (o.t === 'line') {
      if (d.kind === 'p1') patch(d.id, { x: r1(o.x + dx), y: r1(o.y + dy), w: r1(o.w - dx), h: r1(o.h - dy) }, false)
      else patch(d.id, { w: r1(o.w + dx), h: r1(o.h + dy) }, false)
      return
    }
    let { x, y, w, h } = o
    const k = d.kind
    if (k.includes('e')) w = Math.max(1, o.w + dx)
    if (k.includes('w')) { w = Math.max(1, o.w - dx); x = o.x + o.w - w }
    if (k.includes('s')) h = Math.max(o.t === 'text' ? 0.5 : 1, o.h + dy)
    if (k.includes('n')) { h = Math.max(1, o.h - dy); if (o.t !== 'text') y = o.y + o.h - h }
    // pictures and QR codes keep their shape from a corner
    if ((o.t === 'image' && !o.stretch) || o.t === 'qr') {
      if (k.length === 2) { const ratio = o.w / o.h; if (Math.abs(dx) > Math.abs(dy)) { h = w / ratio } else { w = h * ratio }; if (k.includes('w')) x = o.x + o.w - w; if (k.includes('n')) y = o.y + o.h - h }
    }
    if (o.t === 'text' && k.includes('n')) { y = o.y + dy; h = Math.max(o.size * 0.5, o.h - dy) }
    patch(d.id, { x: r1(x), y: r1(y), w: r1(w), h: r1(h) }, false)
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    setGuides({ v: false, h: false })
    // a click without a move records nothing
    if (d && JSON.stringify(design.els.find((e) => e.id === d.id)) === JSON.stringify(d.orig)) setPast((p) => p.slice(0, -1))
  }

  // ---- adding ----
  const centreX = (w: number) => r1((W - w) / 2)
  const addText = (text: string, size = 6, font: 'regular' | 'bold' | 'script' = 'regular') => add({ t: 'text', x: centreX(160), y: r1(H / 2), w: 160, h: size, text, font, size, color: '#1d2470', align: 'center' } as Omit<El, 'id'>)
  const addShape = (t: 'rect' | 'ellipse' | 'poly' | 'line', sides = 6) => {
    if (t === 'line') return add({ t: 'line', x: centreX(80), y: r1(H / 2), w: 80, h: 0, stroke: '#1d2470', sw: 0.6 } as Omit<El, 'id'>)
    const s = t === 'rect' ? { w: 60, h: 36 } : { w: 40, h: t === 'poly' && sides === 6 ? 35 : 40 }
    add({ t, x: centreX(s.w), y: r1((H - s.h) / 2), ...s, fill: '#21c1bd', ...(t === 'poly' ? { sides, r: sides === 6 ? 3 : 0 } : {}) } as Omit<El, 'id'>)
  }
  const placePicture = async (dataUrl: string, as: 'image' | 'background') => {
    const { src, ratio } = await printable(dataUrl)
    if (as === 'background') add({ t: 'image', x: 0, y: 0, w: W, h: H, src, stretch: true, locked: true } as Omit<El, 'id'>, true)
    else { const w = Math.min(90, 60 * Math.max(1, ratio)), h = w / ratio; add({ t: 'image', x: centreX(w), y: r1((H - h) / 2), w: r1(w), h: r1(h), src } as Omit<El, 'id'>) }
  }
  const onFile = async (f: File | undefined) => {
    if (!f || !pick) return
    if (!f.type.startsWith('image/')) return setError('Pick a picture (PNG, JPEG, WebP, SVG…)')
    if (f.size > 8 * 1024 * 1024) return setError('The picture is over 8 MB')
    setBusy(true); setError('')
    try { await placePicture(await readFile(f), pick) } catch { setError('That picture could not be read') } finally { setBusy(false); setPick(null) }
  }
  const fromLink = async () => {
    if (!linkFor) return
    setBusy(true); setError('')
    const r = await fetchDesignImageAction(link)
    if (!r.ok) { setBusy(false); return setError(r.error) }
    try { await placePicture(r.data!, linkFor); setLink(''); setLinkFor(null) } catch { setError('That picture could not be read: try another link') } finally { setBusy(false) }
  }
  const usePreset = (key: string) => {
    if (design.els.length && !confirm('Replace what is on the page with this template? (Undo brings it back.)')) return
    change(presetDesign(key)); setSel(null)
  }

  // ---- saving ----
  function save() {
    if (readOnly) return
    startSave(async () => {
      setError('')
      const res = await fetch('/api/cert-designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, design }) })
      const j = (await res.json().catch(() => ({ ok: false, error: 'The design could not be saved' }))) as { ok: boolean; id?: string; error?: string }
      if (!j.ok) return setError(j.error ?? 'The design could not be saved')
      setDirty(false)
      notify('Design saved')
      if (!id && j.id) router.replace(`/certificate-designs/${j.id}`)
      else router.refresh()
    })
  }
  const saveCopy = () => startSave(async () => {
    const res = await fetch('/api/cert-designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: null, name: `${name} (copy)`, design }) })
    const j = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; id?: string; error?: string }
    if (!j.ok) return setError(j.error ?? 'The copy could not be saved')
    setDirty(false); notify('Saved as a new design'); router.push(`/certificate-designs/${j.id}`)
  })

  const values = sample ? SAMPLE_VALUES : null
  const handles = useMemo(() => {
    if (!selected || readOnly) return null
    if (selected.t === 'line') return [['p1', selected.x, selected.y], ['p2', selected.x + selected.w, selected.y + selected.h]] as [Handle, number, number][]
    const b = bounds(selected)
    const hs: [Handle, number, number][] = [['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y], ['e', b.x + b.w, b.y + b.h / 2], ['se', b.x + b.w, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['sw', b.x, b.y + b.h], ['w', b.x, b.y + b.h / 2]]
    return selected.locked ? [] : hs
  }, [selected, readOnly])
  const HS = Math.max(W, H) / 110 // handle size, mm
  const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'move', p2: 'move' }

  return (
    <section className="page-container cd">
      <style>{DESIGN_FONT_CSS + CSS}</style>
      <div className="cd-top">
        <Link href="/certificate-designs" className="button secondary" onClick={(e) => { if (dirty && !confirm('Leave without saving the changes?')) e.preventDefault() }}><X size={14} /> Close</Link>
        <input className="cd-name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} placeholder="Design name" aria-label="Design name" disabled={readOnly} maxLength={80} />
        <div className="cd-top-actions">
          <button type="button" className="icon-btn" onClick={undo} disabled={!past.length || readOnly} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={16} /></button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!future.length || readOnly} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 size={16} /></button>
          <button type="button" className="button secondary" onClick={() => setSample(!sample)} title="Show the details filled with sample values, or the {{fields}} as typed">{sample ? <><EyeOff size={14} /> Show fields</> : <><Eye size={14} /> Show sample</>}</button>
          {id && <a className="button secondary" href={`/certificate-designs/${id}/preview`} target="_blank" rel="noreferrer"><Eye size={14} /> Print preview</a>}
          {id && !readOnly && <button type="button" className="button secondary" onClick={saveCopy} disabled={saving}><Copy size={14} /> Save as copy</button>}
          {readOnly ? <button type="button" className="button primary" onClick={saveCopy} disabled={saving}><Copy size={14} /> Save a copy for my branch</button>
            : <button type="button" className="button primary" onClick={save} disabled={saving || name.trim().length < 2}><Save size={14} /> {saving ? 'Saving…' : dirty || !id ? 'Save' : 'Saved'}</button>}
        </div>
      </div>
      {error && <p className="form-error" role="alert" style={{ margin: '0 0 10px' }}>{error}</p>}
      {readOnly && <p className="fee-note" role="status">This is head office’s design: you can look at it and save a copy for your branch to change.</p>}

      <div className="cd-grid">
        {/* ---- what to add ---- */}
        <aside className="cd-side">
          <h3>Templates</h3>
          <div className="cd-presets">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className="cd-preset" onClick={() => usePreset(p.key)} disabled={readOnly} title={p.about}>
                <DesignSvg design={p.make()} values={SAMPLE_VALUES} style={{ width: '100%', display: 'block' }} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          <h3>Text</h3>
          <div className="cd-tools">
            <button type="button" onClick={() => addText('Heading', 12, 'bold')} disabled={readOnly}><Type size={15} /> Heading</button>
            <button type="button" onClick={() => addText('Your text here', 4.5)} disabled={readOnly}><Type size={13} /> Text</button>
            <button type="button" onClick={() => add({ t: 'text', x: centreX(180), y: r1(H / 2), w: 180, h: 24, text: 'A paragraph of text that wraps inside its box. Pull the handles to make the box wider or taller.', font: 'regular', size: 4, color: '#4b5563', align: 'center', lineHeight: 1.5 } as Omit<El, 'id'>)} disabled={readOnly}><AlignLeft size={14} /> Paragraph</button>
          </div>
          <label className="cd-field">Participant details
            <select value="" disabled={readOnly} onChange={(e) => { const k = e.target.value as DesignField; if (k) addText(`{{${k}}}`, k === 'name' ? 16 : 5, k === 'name' ? 'script' : 'regular') }}>
              <option value="">Add a detail…</option>
              {(Object.keys(DESIGN_FIELDS) as DesignField[]).map((k) => <option key={k} value={k}>{DESIGN_FIELDS[k].label}</option>)}
            </select>
          </label>
          <h3>Shapes</h3>
          <div className="cd-tools">
            <button type="button" onClick={() => addShape('rect')} disabled={readOnly}><Square size={15} /> Box</button>
            <button type="button" onClick={() => addShape('ellipse')} disabled={readOnly}><Circle size={15} /> Circle</button>
            <button type="button" onClick={() => addShape('poly', 6)} disabled={readOnly}><Hexagon size={15} /> Hexagon</button>
            <button type="button" onClick={() => addShape('poly', 3)} disabled={readOnly}><Triangle size={15} /> Triangle</button>
            <button type="button" onClick={() => addShape('poly', 12)} disabled={readOnly}><Circle size={15} /> Badge</button>
            <button type="button" onClick={() => addShape('line')} disabled={readOnly}><Minus size={15} /> Line</button>
          </div>
          <h3>Pictures</h3>
          <div className="cd-tools">
            <button type="button" onClick={() => { setPick('image'); fileRef.current?.click() }} disabled={readOnly || busy}><Upload size={14} /> Upload</button>
            <button type="button" onClick={() => setLinkFor(linkFor === 'image' ? null : 'image')} disabled={readOnly || busy}><Link2 size={14} /> From a link</button>
            <button type="button" onClick={() => add({ t: 'image', x: centreX(70), y: 14, w: 70, h: r1(70 / (952 / 262)), src: BRAND_LOGO } as Omit<El, 'id'>)} disabled={readOnly || !brand.logo} title={brand.logo ? undefined : 'Upload a logo in Set Up first'}><ImageIcon size={14} /> Your logo</button>
            {/* the signatures of Settings → Certificates, for course certificates */}
            <button type="button" onClick={() => add({ t: 'image', x: 40, y: 150, w: 50, h: 14, src: SIGN_AUTHORISED } as Omit<El, 'id'>)} disabled={readOnly} title="The authorised signature (Settings → Certificates), on course certificates"><ImageIcon size={14} /> Signature</button>
            <button type="button" onClick={() => add({ t: 'image', x: 207, y: 150, w: 50, h: 14, src: SIGN_HEAD } as Omit<El, 'id'>)} disabled={readOnly} title="The head of department’s signature (the course category’s head), on course certificates"><ImageIcon size={14} /> Head’s signature</button>
            <button type="button" onClick={() => add({ t: 'qr', x: W - 30, y: H - 30, w: 18, h: 18, color: '#111827' } as Omit<El, 'id'>)} disabled={readOnly}><QrCode size={14} /> QR code</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          {linkFor && (
            <div className="cd-link">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… (the picture’s own address)" aria-label="Picture link" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') fromLink() }} />
              <button type="button" className="button secondary" onClick={fromLink} disabled={busy || !link.trim()}>{busy ? 'Fetching…' : linkFor === 'background' ? 'Use as page' : 'Add'}</button>
              <small>Right-click a picture on the internet → “Copy image address”, then paste it here.</small>
            </div>
          )}
          <h3>Page</h3>
          <div className="cd-tools">
            <button type="button" className={design.page === 'landscape' ? 'on' : ''} onClick={() => change((d) => ({ ...d, page: 'landscape' }))} disabled={readOnly}>Landscape</button>
            <button type="button" className={design.page === 'portrait' ? 'on' : ''} onClick={() => change((d) => ({ ...d, page: 'portrait' }))} disabled={readOnly}>Portrait</button>
          </div>
          <label className="cd-field">Background colour<input type="color" value={design.bg} onChange={(e) => change((d) => ({ ...d, bg: e.target.value }), false)} onBlur={() => setPast((p) => [...p.slice(-99), design])} disabled={readOnly} /></label>
          <p className="cd-hint">A whole certificate picture (one you made, or found on the internet) as the page, to write the details on:</p>
          <div className="cd-tools">
            <button type="button" onClick={() => { setPick('background'); fileRef.current?.click() }} disabled={readOnly || busy}><Upload size={14} /> Upload page</button>
            <button type="button" onClick={() => setLinkFor(linkFor === 'background' ? null : 'background')} disabled={readOnly || busy}><Link2 size={14} /> Page from a link</button>
          </div>
        </aside>

        {/* ---- the page ---- */}
        <div className="cd-stage" onPointerDown={() => setSel(null)}>
          <div className="cd-paper" style={{ aspectRatio: `${W} / ${H}`, maxWidth: design.page === 'portrait' ? 620 : '100%' }}>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} style={{ touchAction: 'none' }}>
              <rect x={0} y={0} width={W} height={H} fill={design.bg} />
              {fonts && design.els.map((e) => {
                const b = bounds(e)
                return (
                  <g key={e.id} onPointerDown={(ev) => startDrag(ev, e, 'move')} style={{ cursor: readOnly ? 'default' : e.locked ? 'pointer' : 'move', pointerEvents: e.locked && e.id !== sel && e.t === 'image' && e.stretch ? 'none' : undefined }}>
                    <ElDrawing e={e} values={values} />
                    {/* an easy target for thin lines and text */}
                    <rect x={b.x - 1} y={b.y - 1} width={b.w + 2} height={b.h + 2} fill="transparent" />
                  </g>
                )
              })}
              {guides.v && <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#ec4899" strokeWidth={0.25} strokeDasharray="2 1.5" />}
              {guides.h && <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#ec4899" strokeWidth={0.25} strokeDasharray="2 1.5" />}
              {selected && (() => { const b = bounds(selected); return <rect x={b.x} y={b.y} width={Math.max(b.w, 0.5)} height={Math.max(b.h, 0.5)} fill="none" stroke={selected.locked ? '#f59e0b' : '#4f46e5'} strokeWidth={0.3} strokeDasharray={selected.locked ? '1.5 1' : undefined} pointerEvents="none" /> })()}
              {handles?.map(([k, x, y]) => <rect key={k} x={x - HS / 2} y={y - HS / 2} width={HS} height={HS} rx={HS * 0.2} fill="#fff" stroke="#4f46e5" strokeWidth={0.3} style={{ cursor: CURSOR[k] }} onPointerDown={(ev) => startDrag(ev, selected!, k)} />)}
            </svg>
          </div>
          <p className="cd-hint" style={{ textAlign: 'center' }}>{W} × {H} mm · drag to move, pull the handles to resize, arrows nudge (Shift: 5 mm) · the middle of the page snaps</p>
        </div>

        {/* ---- the selected item, and the layers ---- */}
        <aside className="cd-side">
          {selected ? <Inspector e={selected} readOnly={!!readOnly} onPatch={(p, rec) => patch(selected.id, p, rec)} onRecord={() => setPast((p) => [...p.slice(-99), design])}
            onDelete={() => remove(selected.id)} onDuplicate={() => duplicate(selected.id)} onOrder={(to) => reorder(selected.id, to)} />
            : <p className="cd-hint">Click something on the page to change it, or add text, shapes and pictures from the left. Start quickly from a template.</p>}
          <h3>Layers <small>(top first)</small></h3>
          <ol className="cd-layers">
            {[...design.els].reverse().map((e) => (
              <li key={e.id} className={e.id === sel ? 'on' : ''}>
                <button type="button" onClick={() => setSel(e.id)}>{elName(e)}</button>
                <button type="button" className="icon-btn" aria-label={e.locked ? 'Unlock' : 'Lock'} title={e.locked ? 'Locked: click to unlock' : 'Lock in place'} disabled={readOnly} onClick={() => patch(e.id, { locked: !e.locked })}>{e.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
              </li>
            ))}
            {!design.els.length && <li className="cd-hint">Nothing on the page yet.</li>}
          </ol>
        </aside>
      </div>
    </section>
  )
}

/** The selected item's settings. Typing changes it as you go; one undo step per field (recorded on focus). */
function Inspector({ e, readOnly, onPatch, onRecord, onDelete, onDuplicate, onOrder }: {
  e: El; readOnly: boolean; onPatch: (p: Partial<El>, record?: boolean) => void; onRecord: () => void; onDelete: () => void; onDuplicate: () => void; onOrder: (to: 'up' | 'down' | 'top' | 'bottom') => void
}) {
  const n = (label: string, key: string, v: number | undefined, o: { step?: number; min?: number; max?: number } = {}) => (
    <label className="cd-num">{label}<input type="number" value={v ?? ''} step={o.step ?? 0.5} min={o.min} max={o.max} disabled={readOnly} onFocus={onRecord}
      onChange={(ev) => { const x = ev.target.value === '' ? undefined : Number(ev.target.value); if (x === undefined || Number.isFinite(x)) onPatch({ [key]: x } as Partial<El>, false) }} /></label>
  )
  const colour = (label: string, key: string, v: string | null | undefined, optional = false) => (
    <label className="cd-colour">{label}
      <span>
        <input type="color" value={v || '#000000'} disabled={readOnly} onFocus={onRecord} onChange={(ev) => onPatch({ [key]: ev.target.value } as Partial<El>, false)} />
        {optional && <button type="button" className={`cd-none${v ? '' : ' on'}`} disabled={readOnly} onClick={() => onPatch({ [key]: v ? null : '#1d2470' } as Partial<El>)}>{v ? 'None' : 'Add'}</button>}
      </span>
    </label>
  )
  const text = e.t === 'text' ? e : null
  const fit = text ? layoutText(text, fillDesignText(text.text, SAMPLE_VALUES), (s, size) => measure(s, text.font, size, text.track ?? 0)) : null
  return (
    <div className="cd-inspect">
      <div className="cd-inspect-head">
        <h3>{elName(e)}</h3>
        <div>
          <button type="button" className="icon-btn" title="Bring to front" aria-label="Bring to front" disabled={readOnly} onClick={() => onOrder('top')}><ChevronsUp size={14} /></button>
          <button type="button" className="icon-btn" title="Forward" aria-label="Forward" disabled={readOnly} onClick={() => onOrder('up')}><ArrowUp size={14} /></button>
          <button type="button" className="icon-btn" title="Backward" aria-label="Backward" disabled={readOnly} onClick={() => onOrder('down')}><ArrowDown size={14} /></button>
          <button type="button" className="icon-btn" title="Send to back" aria-label="Send to back" disabled={readOnly} onClick={() => onOrder('bottom')}><ChevronsDown size={14} /></button>
          <button type="button" className="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" disabled={readOnly} onClick={onDuplicate}><Copy size={14} /></button>
          <button type="button" className="icon-btn danger" title="Delete" aria-label="Delete" disabled={readOnly} onClick={onDelete}><Trash2 size={14} /></button>
        </div>
      </div>
      {text && <>
        <label className="cd-field">Text <small>{'{{name}}'} and the other details are filled for each person; words in [ ] are left out when a detail in them is empty</small>
          <textarea rows={3} value={text.text} disabled={readOnly} onFocus={onRecord} onChange={(ev) => onPatch({ text: ev.target.value }, false)} />
        </label>
        <div className="cd-chips">
          {(Object.keys(DESIGN_FIELDS) as DesignField[]).map((k) => <button key={k} type="button" disabled={readOnly} title={DESIGN_FIELDS[k].label} onClick={() => onPatch({ text: `${text.text}${text.text && !/\s$/.test(text.text) ? ' ' : ''}{{${k}}}` })}>{k}</button>)}
        </div>
        <label className="cd-field">Font<select value={text.font} disabled={readOnly} onChange={(ev) => onPatch({ font: ev.target.value as typeof text.font })}>{FONT_KEYS.map((f) => <option key={f} value={f}>{FONT_LABEL[f]}</option>)}</select></label>
        <div className="cd-row">
          {n('Size (mm)', 'size', text.size, { step: 0.2, min: 0.5 })}
          {colour('Colour', 'color', text.color)}
        </div>
        <div className="cd-row">
          <div className="seg cd-seg" role="group" aria-label="Alignment">
            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as [Align, typeof AlignLeft][]).map(([a, I]) => <button key={a} type="button" className={text.align === a ? 'on' : ''} aria-pressed={text.align === a} disabled={readOnly} onClick={() => onPatch({ align: a })}><I size={14} /></button>)}
          </div>
          <label className="cd-check"><input type="checkbox" checked={!!text.upper} disabled={readOnly} onChange={() => onPatch({ upper: !text.upper })} /> CAPITALS</label>
        </div>
        <div className="cd-row">
          {n('Letter spacing', 'track', text.track ?? 0, { step: 0.02 })}
          {n('Line height', 'lineHeight', text.lineHeight ?? 1.25, { step: 0.05, min: 0.6 })}
        </div>
        {fit && fit.size < text.size - 0.01 && <p className="cd-hint">With the sample details it is shrunk to {fit.size.toFixed(1)} mm to fit its box: a long name gets smaller instead of running out. Make the box wider (or taller, for more lines) to keep the size.</p>}
      </>}
      {(e.t === 'rect' || e.t === 'ellipse' || e.t === 'poly') && <>
        <div className="cd-row">{colour('Fill', 'fill', e.fill, true)}{colour('Outline', 'stroke', e.stroke, true)}</div>
        <div className="cd-row">
          {n('Outline width', 'sw', e.sw ?? 0, { step: 0.1, min: 0 })}
          {e.t !== 'ellipse' && n('Round corners', 'r', e.r ?? 0, { step: 0.5, min: 0 })}
        </div>
        {e.t !== 'ellipse' && <div className="cd-row">
          {e.t === 'poly' && n('Sides', 'sides', e.sides, { step: 1, min: 3, max: 12 })}
          {n('Turn (°)', 'rot', e.rot ?? 0, { step: 5 })}
        </div>}
      </>}
      {e.t === 'line' && <div className="cd-row">{colour('Colour', 'stroke', e.stroke)}{n('Width', 'sw', e.sw, { step: 0.1, min: 0.05 })}<label className="cd-check"><input type="checkbox" checked={!!e.dash} disabled={readOnly} onChange={() => onPatch({ dash: !e.dash })} /> Dashed</label></div>}
      {e.t === 'qr' && <><div className="cd-row">{colour('Colour', 'color', e.color)}</div><p className="cd-hint">Opens the participant’s own certificate page, so anyone can check it is genuine.</p></>}
      {e.t === 'image' && <label className="cd-check"><input type="checkbox" checked={!!e.stretch} disabled={readOnly} onChange={() => onPatch({ stretch: !e.stretch })} /> Stretch to fill its box</label>}
      {e.t !== 'text' && e.t !== 'qr' && <label className="cd-field">See-through <input type="range" min={0.05} max={1} step={0.05} value={e.opacity ?? 1} disabled={readOnly} onPointerDown={onRecord} onChange={(ev) => onPatch({ opacity: Number(ev.target.value) }, false)} /></label>}
      <h3 className="cd-sub">Position (mm)</h3>
      <div className="cd-row">{n('X', 'x', e.x)}{n('Y', 'y', e.y)}</div>
      <div className="cd-row">{n(e.t === 'line' ? 'Across' : 'Width', 'w', e.w)}{n(e.t === 'line' ? 'Down' : e.t === 'text' ? 'Box height' : 'Height', 'h', e.h)}</div>
    </div>
  )
}

const CSS = `
.cd { max-width: none !important; }
.cd-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.cd-name { flex: 1 1 220px; min-width: 0; height: 42px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; font-size: 15px; font-weight: 700; color: var(--ink); background: #fff; }
.cd-top-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.cd .icon-btn { width: 32px; height: 32px; display: inline-grid; place-items: center; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--ink); }
.cd .icon-btn:disabled { opacity: .4; }
.cd .icon-btn.danger { color: #dc2626; }
.cd-grid { display: grid; grid-template-columns: 250px minmax(0, 1fr) 270px; gap: 14px; align-items: start; }
@media (max-width: 1180px) { .cd-grid { grid-template-columns: 220px minmax(0, 1fr); } .cd-grid > aside:last-child { grid-column: 1 / -1; } }
@media (max-width: 760px) { .cd-grid { grid-template-columns: 1fr; } }
.cd-side { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 12px; max-height: calc(100vh - 150px); overflow: auto; position: sticky; top: 12px; }
.cd-side h3 { margin: 12px 0 8px; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.cd-side h3:first-child { margin-top: 0; }
.cd-side h3 small { text-transform: none; letter-spacing: 0; font-weight: 600; }
.cd-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cd-preset { display: grid; gap: 4px; padding: 5px; border: 1px solid var(--line); border-radius: 10px; background: var(--tint-2); text-align: left; cursor: pointer; }
.cd-preset:hover:not(:disabled) { border-color: #a5b4fc; }
.cd-preset svg { border-radius: 4px; box-shadow: 0 1px 4px #0002; max-height: 110px; }
.cd-preset span { font-size: 10.5px; font-weight: 700; color: var(--ink); line-height: 1.2; }
.cd-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.cd-tools button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--ink); font-size: 12px; font-weight: 600; }
.cd-tools button:hover:not(:disabled) { background: var(--tint); }
.cd-tools button.on { background: var(--ink); color: #fff; }
.cd-field { display: grid; gap: 5px; margin-top: 10px; font-size: 12px; font-weight: 700; color: var(--ink); }
.cd-field small { font-weight: 500; color: var(--muted); }
.cd-field select, .cd-field textarea, .cd-link input { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-weight: 500; background: #fff; }
.cd-field input[type=color] { width: 100%; height: 32px; border: 1px solid var(--line); border-radius: 9px; padding: 2px; background: #fff; }
.cd-link { display: grid; gap: 6px; margin-top: 8px; }
.cd-link small, .cd-hint { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.cd-hint { margin: 8px 0 0; }
.cd-stage { min-width: 0; display: grid; justify-items: center; gap: 6px; padding: 18px; border-radius: 16px; background: repeating-conic-gradient(#eceef6 0 25%, #f6f7fb 0 50%) 0 0 / 18px 18px; }
.cd-paper { width: 100%; box-shadow: 0 10px 40px #0f143733; background: #fff; }
.cd-paper svg { display: block; width: 100%; height: 100%; user-select: none; }
.cd-inspect-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.cd-inspect-head h3 { margin: 0 !important; text-transform: none !important; letter-spacing: 0 !important; color: var(--ink) !important; font-size: 14px !important; }
.cd-inspect-head > div { display: flex; gap: 4px; flex-wrap: wrap; }
.cd-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 10px; }
.cd-num, .cd-colour { display: grid; gap: 4px; flex: 1 1 90px; font-size: 11.5px; font-weight: 700; color: var(--ink); }
.cd-num input { width: 100%; height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 9px; }
.cd-colour span { display: flex; gap: 4px; }
.cd-colour input { flex: 1; height: 32px; min-width: 40px; border: 1px solid var(--line); border-radius: 9px; padding: 2px; background: #fff; }
.cd-none { height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 9px; background: #fff; font-size: 11px; font-weight: 700; }
.cd-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--ink); margin-top: 10px; }
.cd-seg { margin: 0 !important; }
.cd-seg button { padding: 0 10px !important; }
.cd-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.cd-chips button { padding: 3px 7px; border: 1px solid #c7d2fe; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 10.5px; font-weight: 700; }
.cd-sub { margin-top: 14px !important; }
.cd-layers { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.cd-layers li { display: flex; align-items: center; gap: 4px; border-radius: 8px; }
.cd-layers li.on { background: var(--tint); }
.cd-layers li > button:first-child { flex: 1; min-width: 0; padding: 6px 8px; border: 0; background: transparent; text-align: left; font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-layers .icon-btn { width: 26px; height: 26px; border: 0; background: transparent; }
`

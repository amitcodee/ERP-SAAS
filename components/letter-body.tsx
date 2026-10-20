'use client'
// A letter on techcadd letterhead, laid out as real A4 pages: each page carries the letterhead (public/letterhead.jpg,
// from the official letterhead PDF) and the text flows between its header and footer. The same pages show on screen
// and print one per sheet. Used by the print page and by the template editor's live preview.
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { toBlocks, type Inline } from '@/lib/letters/render'

const Line = ({ parts }: { parts: Inline[] }) => (
  <>{parts.map((p, i) => (p.missing ? <mark key={i} className="lt-missing" title="Fill this in on the intern's details">{p.text}</mark> : p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</>
)

const CLOSING = /^(regards|warm regards|best regards|yours (sincerely|faithfully|truly)|sincerely),?$/i

/** The letter cut into pieces that may go to a new page: headings, paragraphs and single list items (numbering kept). */
function pieces(text: string, sign: string | null): { node: ReactNode; keepWithNext?: boolean }[] {
  const out: { node: ReactNode; keepWithNext?: boolean }[] = []
  toBlocks(text).forEach((b, i) => {
    if (b.type === 'h1') out.push({ node: <h1 key={i}><Line parts={b.lines[0]} /></h1>, keepWithNext: true })
    else if (b.type === 'h2') out.push({ node: <h2 key={i}><Line parts={b.lines[0]} /></h2>, keepWithNext: true })
    else if (b.type === 'p') {
      out.push({ node: <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Line parts={l} /></Fragment>)}</p> })
      // the sign-off: the company's stamp and signature under "Regards,", kept on the same page as the name that follows
      if (sign && CLOSING.test(b.lines.map((l) => l.map((x) => x.text).join('')).join(' ').trim())) {
        out[out.length - 1].keepWithNext = true
        out.push({ node: <img key={`${i}-sign`} className="lt-sign" src={sign} alt="Authorised signatory's stamp and signature" />, keepWithNext: true })
      }
    }
    else if (b.type === 'ol') b.items.forEach((it, j) => out.push({ node: <ol key={`${i}-${j}`} start={j + 1}><li><Line parts={it} /></li></ol> }))
    else b.items.forEach((it, j) => out.push({ node: <ul key={`${i}-${j}`}><li><Line parts={it} /></li></ul> }))
  })
  return out
}

export function LetterBody({ text, sign = null }: { text: string; sign?: string | null }) {
  return <div className="lt-body">{pieces(text, sign).map((p, i) => <div key={i} className="lt-piece">{p.node}</div>)}</div>
}

/** letterhead: the full-page image the letter is printed on; sign: the stamp / signature under "Regards," (none: no stamp).
 *  Both are the intern's company's (modules/letters/service companyArt). */
export function LetterSheet({ text, refNo, date, draft, cancelled, letterhead = '/letterhead.jpg', sign = null }: { text: string; refNo: string; date: string; draft?: boolean; cancelled?: boolean; letterhead?: string; sign?: string | null }) {
  const all: { node: ReactNode; keepWithNext?: boolean }[] = [{ node: <div className="lt-ref"><span>Ref. {refNo}</span><span>Date: {date}</span></div> }, ...pieces(text, sign)]
  const measure = useRef<HTMLDivElement>(null)
  // page breaks: the index of the first piece on each page after the first (null until measured)
  const [breaks, setBreaks] = useState<number[] | null>(null)

  useLayoutEffect(() => {
    const run = () => {
      const box = measure.current
      if (!box) return
      const room = (box.firstElementChild as HTMLElement).getBoundingClientRect().height // one page of text, in this context's units
      const hs = [...box.querySelectorAll<HTMLElement>(':scope > .lt-body > .lt-piece')].map((el) => el.getBoundingClientRect().height)
      const next: number[] = []
      let used = 0
      hs.forEach((h, i) => {
        if (used > 0 && used + h > room) {
          // a heading (or the sign-off: "Regards," and the stamp) left alone at the foot of a page goes over with its text
          let start = i
          while (start > 1 && all[start - 1].keepWithNext && next[next.length - 1] !== start - 1) start--
          next.push(start)
          used = hs.slice(start, i + 1).reduce((a, b) => a + b, 0)
        } else used += h
      })
      setBreaks((prev) => (prev && prev.join() === next.join() ? prev : next))
    }
    run()
    document.fonts?.ready.then(run)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, refNo, date, sign])

  const starts = [0, ...(breaks ?? [])]
  const ranges = starts.map((s, k) => [s, starts[k + 1] ?? all.length])
  return (
    <div className="lt-doc">
      <div ref={measure} className="lt-measure" aria-hidden>
        <div className="lt-room" />
        <div className="lt-body">{all.map((p, i) => <div key={i} className="lt-piece">{p.node}</div>)}</div>
      </div>
      {ranges.map(([from, to], n) => (
        <article key={n} className="lt-sheet">
          <img className="lt-bg" src={letterhead} alt="" aria-hidden />
          <div className="lt-text lt-body">{all.slice(from, to).map((p, i) => <div key={from + i} className="lt-piece">{p.node}</div>)}</div>
          {ranges.length > 1 && <div className="lt-pageno">Page {n + 1} of {ranges.length}</div>}
          {n === 0 && (draft || cancelled) && <div className="lt-stamp">{cancelled ? 'CANCELLED' : 'DRAFT — NOT ISSUED'}</div>}
        </article>
      ))}
    </div>
  )
}

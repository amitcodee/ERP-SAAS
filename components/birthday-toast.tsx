'use client'
// Bottom-right, on every panel page: the students whose birthday it is today, with a one-tap WhatsApp wish. Closed,
// it stays closed for the day (this browser) and leaves a small 🎂 button to open it again.
import { useEffect, useState } from 'react'
import { ChevronDown, MessageCircle, X } from 'lucide-react'
import type { TodaysBirthday } from '@/modules/notifications/birthday'

export function BirthdayToast({ people, today, showBranch }: { people: TodaysBirthday[]; today: string; showBranch: boolean }) {
  const key = `tc-staff-bday-${today}`
  const [open, setOpen] = useState(false)
  const [mini, setMini] = useState(false)
  useEffect(() => {
    let closed = false
    try { closed = localStorage.getItem(key) === '1' } catch { /* show it */ }
    setOpen(!closed)
  }, [key])
  const close = () => { setOpen(false); try { localStorage.setItem(key, '1') } catch { /* ignore */ } }
  const wa = (p: TodaysBirthday) => `https://wa.me/91${p.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(`Happy Birthday, ${p.firstName}! 🎉🎂 Wishing you a wonderful year ahead — from all of us at techcadd.`)}`

  return (
    <>
      <style>{`
        .bt-card { position: fixed; right: 20px; bottom: 20px; z-index: 60; width: min(360px, calc(100vw - 32px)); border-radius: 16px; background: var(--card, #fff); border: 1px solid var(--line, #e3e6ef); box-shadow: 0 24px 60px -18px rgba(16,24,106,.35); overflow: hidden; animation: bt-in .45s cubic-bezier(.2,1.3,.4,1); }
        .bt-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; color: #fff; background: linear-gradient(90deg, #f43f5e, #8b5cf6); }
        .bt-head strong { flex: 1; font-size: 14.5px; }
        .bt-head button { border: 0; background: rgba(255,255,255,.18); color: #fff; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; }
        .bt-cake { font-size: 22px; animation: bt-wiggle 1.8s ease-in-out infinite; }
        .bt-list { max-height: 300px; overflow: auto; padding: 6px 0; margin: 0; list-style: none; }
        .bt-list li { display: flex; gap: 10px; align-items: center; padding: 9px 14px; }
        .bt-list li + li { border-top: 1px solid var(--line, #eef0f6); }
        .bt-list div { flex: 1; min-width: 0; }
        .bt-list b { display: block; font-size: 14px; }
        .bt-list small { color: var(--muted, #6b7280); font-size: 12px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bt-wa { display: inline-flex; gap: 5px; align-items: center; padding: 6px 10px; border-radius: 999px; background: #22c55e; color: #fff; font-size: 12.5px; font-weight: 700; text-decoration: none; white-space: nowrap; }
        .bt-mini { position: fixed; right: 20px; bottom: 20px; z-index: 60; width: 50px; height: 50px; border-radius: 50%; border: 0; font-size: 24px; cursor: pointer; background: linear-gradient(135deg, #f43f5e, #8b5cf6); box-shadow: 0 12px 28px -10px rgba(139,92,246,.8); animation: bt-wiggle 2.4s ease-in-out infinite; }
        .bt-mini i { position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #fff; color: #e11d48; font: 700 11.5px/20px inherit; font-style: normal; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
        @keyframes bt-in { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes bt-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-8deg); } 75% { transform: rotate(8deg); } }
        @media (prefers-reduced-motion: reduce) { .bt-card, .bt-cake, .bt-mini { animation: none; } }
      `}</style>
      {open && !mini ? (
        <section className="bt-card" role="status" aria-label="Birthdays today">
          <div className="bt-head">
            <span className="bt-cake" aria-hidden>🎂</span>
            <strong>{people.length === 1 ? `${people[0].firstName}’s birthday today!` : `${people.length} birthdays today!`}</strong>
            <button type="button" title="Make smaller" aria-label="Make smaller" onClick={() => setMini(true)}><ChevronDown size={16} /></button>
            <button type="button" title="Close for today" aria-label="Close for today" onClick={close}><X size={16} /></button>
          </div>
          <ul className="bt-list">
            {people.map((p) => (
              <li key={p.registrationId}>
                <div>
                  <b>{p.name}{p.age ? ` · turns ${p.age}` : ''}</b>
                  <small>{p.regNo}{p.course ? ` · ${p.course}` : ''}{showBranch ? ` · ${p.branch}` : ''}</small>
                </div>
                <a className="bt-wa" href={wa(p)} target="_blank" rel="noreferrer" title={`Wish ${p.firstName} on WhatsApp`}><MessageCircle size={13} /> Wish</a>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <button type="button" className="bt-mini" title="Birthdays today" aria-label={`${people.length} birthdays today`} onClick={() => { setMini(false); setOpen(true) }}>🎂<i>{people.length}</i></button>
      )}
    </>
  )
}

'use client'
// The student's birthday: the portal opens with balloons rising, confetti falling and a birthday card. Once closed it
// stays closed for the day (this browser) and a small "Happy birthday" pill brings it back. Calm when the device asks
// for reduced motion.
import { useEffect, useMemo, useState } from 'react'

const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#facc15']
// a fixed pseudo-random spread, so the server and the browser draw the same picture
const rnd = (i: number, salt: number) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x) }

export function BirthdayCelebration({ birthday }: { birthday: { firstName: string; age: number | null; year: string; heading?: string; message?: string } | null | undefined }) {
  const key = birthday ? `tc-bday-${birthday.year}` : ''
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!birthday) return
    let seen = false
    try { seen = localStorage.getItem(key) === '1' } catch { /* private window: show it */ }
    setOpen(!seen)
  }, [birthday, key])
  const balloons = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    left: 4 + rnd(i, 1) * 92, delay: rnd(i, 2) * 4, dur: 7 + rnd(i, 3) * 5, size: 46 + rnd(i, 4) * 30, color: COLORS[i % COLORS.length], sway: 10 + rnd(i, 5) * 22,
  })), [])
  const confetti = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: rnd(i, 6) * 100, delay: rnd(i, 7) * 3, dur: 3 + rnd(i, 8) * 3, color: COLORS[(i * 3) % COLORS.length], rot: rnd(i, 9) * 360, w: 6 + rnd(i, 10) * 6, round: i % 3 === 0,
  })), [])
  if (!birthday) return null
  const close = () => { setOpen(false); try { localStorage.setItem(key, '1') } catch { /* ignore */ } }

  return (
    <>
      <style>{`
        .bd-wrap { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 16px; background: radial-gradient(circle at 50% 40%, rgba(26,31,113,.55), rgba(10,12,40,.82)); overflow: hidden; animation: bd-fade .4s ease-out; }
        .bd-balloon { position: absolute; bottom: -160px; border-radius: 50% 50% 48% 48% / 55% 55% 45% 45%; animation: bd-rise linear infinite; box-shadow: inset -10px -12px 0 rgba(0,0,0,.12), inset 8px 8px 0 rgba(255,255,255,.25); }
        .bd-balloon::before { content: ''; position: absolute; left: 50%; bottom: -7px; transform: translateX(-50%); border: 6px solid transparent; border-bottom-color: inherit; border-bottom-width: 8px; filter: brightness(.85); }
        .bd-balloon::after { content: ''; position: absolute; left: 50%; top: 100%; width: 1px; height: 90px; background: rgba(255,255,255,.55); transform-origin: top; animation: bd-string 2s ease-in-out infinite alternate; }
        .bd-confetti { position: absolute; top: -20px; animation: bd-fall linear infinite; }
        .bd-card { position: relative; z-index: 2; width: min(440px, 100%); padding: 30px 26px 24px; border-radius: 22px; text-align: center; background: linear-gradient(160deg, #ffffff 0%, #fff1f6 55%, #eef2ff 100%); box-shadow: 0 30px 80px -20px rgba(0,0,0,.55); animation: bd-pop .6s cubic-bezier(.2,1.4,.4,1) both .15s; font-family: inherit; }
        .bd-cake { font-size: 64px; line-height: 1; animation: bd-bounce 1.6s ease-in-out infinite; display: inline-block; }
        .bd-card h2 { margin: 12px 0 6px; font-size: 30px; line-height: 1.15; color: #1a1f71; font-family: Georgia, 'Times New Roman', serif; }
        .bd-card h2 span { background: linear-gradient(90deg, #f43f5e, #f59e0b, #8b5cf6, #3b82f6); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .bd-age { display: inline-block; margin: 2px 0 12px; padding: 5px 14px; border-radius: 999px; background: #1a1f71; color: #fff; font-weight: 700; font-size: 13.5px; }
        .bd-card p { margin: 0 0 18px; color: #3b4256; font-size: 15px; line-height: 1.55; }
        .bd-card button { border: 0; border-radius: 999px; padding: 12px 26px; font: inherit; font-weight: 700; font-size: 15px; color: #fff; cursor: pointer; background: linear-gradient(90deg, #f43f5e, #8b5cf6); box-shadow: 0 10px 24px -10px #8b5cf6; }
        .bd-card button:hover { filter: brightness(1.05); transform: translateY(-1px); }
        .bd-sign { margin-top: 14px; font-size: 12.5px; color: #6b7280; }
        .bd-pill { position: fixed; right: 16px; bottom: 16px; z-index: 50; border: 0; border-radius: 999px; padding: 10px 16px; font: inherit; font-weight: 700; font-size: 13.5px; color: #fff; cursor: pointer; background: linear-gradient(90deg, #f43f5e, #8b5cf6); box-shadow: 0 10px 24px -8px rgba(139,92,246,.7); animation: bd-bounce 2.4s ease-in-out infinite; }
        @media (max-width: 760px) { .bd-pill { bottom: 84px; } }
        @keyframes bd-rise { from { transform: translate(0, 0); } 50% { transform: translate(var(--sway), -55vh); } to { transform: translate(0, -120vh); } }
        @keyframes bd-fall { from { transform: translateY(0) rotate(0); } to { transform: translateY(110vh) rotate(720deg); } }
        @keyframes bd-string { from { transform: rotate(-6deg); } to { transform: rotate(6deg); } }
        @keyframes bd-pop { from { opacity: 0; transform: scale(.6) translateY(30px); } to { opacity: 1; transform: none; } }
        @keyframes bd-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes bd-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .bd-balloon, .bd-confetti, .bd-cake, .bd-pill, .bd-card, .bd-balloon::after { animation: none !important; } .bd-balloon { bottom: auto; top: 70%; } .bd-confetti { display: none; } }
      `}</style>
      {open ? (
        <div className="bd-wrap" role="dialog" aria-modal="true" aria-label={`Happy birthday, ${birthday.firstName}`} onMouseDown={(e) => e.currentTarget === e.target && close()}>
          {balloons.map((b, i) => <span key={`b${i}`} aria-hidden className="bd-balloon" style={{ left: `${b.left}%`, width: b.size, height: b.size * 1.2, background: b.color, borderBottomColor: b.color, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`, ['--sway' as string]: `${i % 2 ? '-' : ''}${b.sway}px` }} />)}
          {confetti.map((c, i) => <span key={`c${i}`} aria-hidden className="bd-confetti" style={{ left: `${c.left}%`, width: c.w, height: c.round ? c.w : c.w * 1.8, background: c.color, borderRadius: c.round ? '50%' : 2, transform: `rotate(${c.rot}deg)`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />)}
          <div className="bd-card">
            <span className="bd-cake" aria-hidden>🎂</span>
            <h2>{birthday.heading ? <span>{birthday.heading}</span> : <>Happy Birthday,<br /><span>{birthday.firstName}!</span></>}</h2>
            {birthday.age && <div className="bd-age">🎉 {birthday.age} today 🎉</div>}
            <p style={{ whiteSpace: 'pre-line' }}>{birthday.message ?? 'Wishing you a fantastic day and a year full of learning, success and happiness. Keep shining — we are proud to be part of your journey!'}</p>
            <button type="button" onClick={close} autoFocus>Thank you! 🎈</button>
            <div className="bd-sign">With warm wishes, from everyone at techcadd</div>
          </div>
        </div>
      ) : (
        <button type="button" className="bd-pill" onClick={() => setOpen(true)} title="Open your birthday wishes again">🎂 Happy Birthday, {birthday.firstName}!</button>
      )}
    </>
  )
}

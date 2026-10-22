'use client'
// Administration / Sign-in Security: the sign-in log (who, when, from which IP, place and device, what happened),
// accounts and IPs locked right now, and IPs blocked (by the ladder or by hand) or trusted (a branch office).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CircleCheck, Globe, LockOpen, MapPin, Monitor, Search, ShieldCheck, Smartphone, Unlock } from 'lucide-react'
import { clearLockAction, loginLogAction, removeIpRuleAction, setIpRuleAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { DateInput } from '@/components/date-input'
import type { AttemptResult, IpRuleRow, LockRow, LoginLogRow, LoginStats } from '@/modules/auth/guard'

type Log = { rows: LoginLogRow[]; total: number; pages: number }
type Filter = { q: string; result: '' | 'success' | 'failed' | 'locked' | 'blocked_ip' | 'two_factor'; from: string; to: string; page: number }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })
const RESULT: Record<AttemptResult, [string, string]> = {
  success: ['Signed in', 'green'], two_factor_sent: ['Password OK, code sent', 'blue'], two_factor_wrong: ['Wrong code', 'amber'],
  wrong_password: ['Wrong password', 'amber'], unknown_email: ['No such account', 'amber'], inactive: ['Login switched off', 'slate'],
  branch_not_ready: ['Branch not active', 'slate'], locked: ['Refused: locked', 'red'], blocked_ip: ['Refused: IP blocked', 'red'],
}
const waitText = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`)

/** "Chrome on Windows", "Safari on iPhone" from the browser's user agent. */
function device(ua: string | null): { label: string; phone: boolean } {
  if (!ua) return { label: '—', phone: false }
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|python|bot|spider|Go-http/i.test(ua) ? 'Script / bot' : 'Browser'
  return { label: os ? `${br} on ${os}` : br, phone: /iPhone|Android|Mobile/.test(ua) }
}

export function LoginSecurityPanel({ initial, rules, locks, stats, ladder }: {
  initial: Log; rules: IpRuleRow[]; locks: LockRow[]; stats: LoginStats; ladder: { free: number; step: number; waits: number[] }
}) {
  const [tab, setTab] = useState<'log' | 'ips'>('log')
  const [log, setLog] = useState<Log>(initial)
  const [f, setF] = useState<Filter>({ q: '', result: '', from: '', to: '', page: 1 })
  const [loading, setLoading] = useState(false)
  const [ruleFor, setRuleFor] = useState<{ ip: string; kind: 'block' | 'allow' } | null>(null)
  const [pending, start] = useTransition()
  const notify = useNotify()
  const router = useRouter()
  const blocked = rules.filter((r) => r.kind === 'block'), trusted = rules.filter((r) => r.kind === 'allow')

  const load = async (next: Filter) => {
    setF(next); setLoading(true)
    const r = await loginLogAction(next)
    setLoading(false)
    if (r.ok) setLog(r.data!); else notify(r.error)
  }
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => {
    const r = await fn(); notify(r.ok ? ok : r.error ?? 'Could not save')
    if (r.ok) { router.refresh(); void load(f) }
  })

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Security &amp; records / Sign-in security</p><h1>Sign-in security</h1>
          <p className="subheading">Every sign-in attempt with its IP, place and device. {ladder.free + 1}th wrong password locks for {waitText(ladder.waits[0])}, then every {ladder.step} more: {ladder.waits.slice(1).map(waitText).join(', ')}; after that the IP is blocked until you unblock it. A correct password starts the count over.</p></div>
        <div className="heading-actions"><button type="button" className="button primary" onClick={() => setRuleFor({ ip: '', kind: 'block' })}><Ban size={16} /> Block an IP</button><button type="button" className="button secondary" onClick={() => setRuleFor({ ip: '', kind: 'allow' })}><ShieldCheck size={16} /> Trust an IP</button></div>
      </div>

      <div className="ls-stats">
        <div><small>Sign-in attempts today</small><strong>{stats.today}</strong></div>
        <div className={stats.failedToday ? 'warn' : ''}><small>Failed today</small><strong>{stats.failedToday}</strong></div>
        <div className={stats.lockedNow ? 'warn' : ''}><small>Locked right now</small><strong>{stats.lockedNow}</strong></div>
        <div className={stats.blocked ? 'bad' : ''}><small>Blocked IPs</small><strong>{stats.blocked}</strong></div>
      </div>

      <div className="cd-tabs" role="tablist" style={{ marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Sign-in log <b>{log.total}</b></button>
        <button type="button" role="tab" aria-selected={tab === 'ips'} className={tab === 'ips' ? 'on' : ''} onClick={() => setTab('ips')}>Blocked, trusted &amp; locked <b>{blocked.length + trusted.length + locks.length}</b></button>
      </div>

      {tab === 'log' ? (
        <div className="panel table-panel">
          <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
            <form className="table-search" onSubmit={(e) => { e.preventDefault(); void load({ ...f, page: 1 }) }}>
              <Search size={16} /><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search e-mail, name or IP… (Enter)" aria-label="Search the sign-in log" />
            </form>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={f.result} aria-label="Result" onChange={(e) => void load({ ...f, result: e.target.value as Filter['result'], page: 1 })}>
                <option value="">All results</option><option value="success">Signed in</option><option value="failed">Failed</option><option value="locked">Refused: locked</option><option value="blocked_ip">Refused: IP blocked</option><option value="two_factor">Two-step code</option>
              </select>
              <DateInput type="date" value={f.from} aria-label="From" onChange={(e) => void load({ ...f, from: e.target.value, page: 1 })} />
              <DateInput type="date" value={f.to} aria-label="To" onChange={(e) => void load({ ...f, to: e.target.value, page: 1 })} />
              {(f.q || f.result || f.from || f.to) && <button type="button" className="filter-button" onClick={() => void load({ q: '', result: '', from: '', to: '', page: 1 })}>Clear</button>}
            </div>
          </div>
          <div className="table-scroll"><table>
            <thead><tr><th>When</th><th>Account</th><th>Result</th><th>IP</th><th>Location</th><th>Device</th><th /></tr></thead>
            <tbody style={{ opacity: loading ? 0.5 : 1 }}>
              {log.rows.map((r) => {
                const d = device(r.userAgent)
                const [label, tone] = RESULT[r.result] ?? [r.result, 'slate']
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                    <td>{r.user ? <><strong>{r.user}</strong><small style={{ display: 'block' }}>{r.email}</small></> : <span>{r.email ?? '—'}</span>}</td>
                    <td><span className={`status-badge status-${tone}`}><span className="status-dot" />{label}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}><code>{r.ip ?? '—'}</code>{r.blocked && <small className="text-red" style={{ display: 'block' }}>Blocked</small>}{r.trusted && <small style={{ display: 'block', color: '#0e8a44' }}>Trusted</small>}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{r.place ? <><MapPin size={12} style={{ verticalAlign: -1 }} /> {r.place}</> : <span style={{ color: '#8b98aa' }}>{r.ip ? 'Looking up…' : '—'}</span>}{r.isp && <small style={{ display: 'block' }}>{r.isp}</small>}</td>
                    <td title={r.userAgent ?? undefined} style={{ whiteSpace: 'nowrap' }}>{d.phone ? <Smartphone size={13} style={{ verticalAlign: -2 }} /> : <Monitor size={13} style={{ verticalAlign: -2 }} />} {d.label}</td>
                    <td>{r.ip && !r.blocked && !r.trusted && <button type="button" className="filter-button icon-only danger" title={`Block ${r.ip}`} aria-label={`Block ${r.ip}`} onClick={() => setRuleFor({ ip: r.ip!, kind: 'block' })}><Ban size={14} /></button>}</td>
                  </tr>
                )
              })}
              {!log.rows.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{loading ? 'Loading…' : 'No sign-in attempts match.'}</td></tr>}
            </tbody>
          </table></div>
          <div className="table-toolbar" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
            <small>{log.total} attempt{log.total === 1 ? '' : 's'} · page {f.page} of {log.pages}</small>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="filter-button" disabled={f.page <= 1 || loading} onClick={() => void load({ ...f, page: f.page - 1 })}>Newer</button>
              <button type="button" className="filter-button" disabled={f.page >= log.pages || loading} onClick={() => void load({ ...f, page: f.page + 1 })}>Older</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <IpTable title="Blocked IPs" icon={<Ban size={16} />} empty="No IP is blocked." rows={blocked} pending={pending}
            hint="Nobody can sign in from these. Blocked automatically after the full ladder of wrong passwords, or by hand."
            onRemove={(ip) => act(() => removeIpRuleAction(ip), `${ip} unblocked`)} removeLabel="Unblock" />
          <IpTable title="Trusted IPs" icon={<ShieldCheck size={16} />} empty="No trusted IP yet. Add each branch office's internet IP so a typo there never locks the whole office." rows={trusted} pending={pending}
            hint="Never locked or blocked by IP (wrong passwords still lock the account itself for a while)."
            onRemove={(ip) => act(() => removeIpRuleAction(ip), `${ip} is no longer trusted`)} removeLabel="Remove" />
          <div className="panel table-panel">
            <div className="table-toolbar"><strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LockOpen size={16} /> Locked right now</strong><small>Lifts by itself when the time runs out.</small></div>
            <div className="table-scroll"><table>
              <thead><tr><th>Locked</th><th>Wrong tries</th><th>Step</th><th>Until</th><th /></tr></thead>
              <tbody>
                {locks.map((l) => (
                  <tr key={l.key}>
                    <td>{l.kind === 'ip' ? <><Globe size={13} style={{ verticalAlign: -2 }} /> IP <code>{l.value}</code></> : <>Account <strong>{l.value}</strong></>}</td>
                    <td>{l.failures}</td>
                    <td>{l.level} of {ladder.waits.length}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(l.until)}</td>
                    <td><button type="button" className="filter-button" disabled={pending} onClick={() => act(() => clearLockAction(l.key), 'Lock lifted')}><Unlock size={13} /> Lift now</button></td>
                  </tr>
                ))}
                {!locks.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 22, color: '#8b98aa' }}>Nothing is locked right now.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </div>
      )}
      {ruleFor && <RuleForm init={ruleFor} onClose={() => setRuleFor(null)} onDone={(m) => { setRuleFor(null); notify(m); router.refresh(); void load(f) }} />}
    </section>
  )
}

function IpTable({ title, icon, hint, empty, rows, pending, onRemove, removeLabel }: { title: string; icon: React.ReactNode; hint: string; empty: string; rows: IpRuleRow[]; pending: boolean; onRemove: (ip: string) => void; removeLabel: string }) {
  return (
    <div className="panel table-panel">
      <div className="table-toolbar"><strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{icon} {title}</strong><small>{hint}</small></div>
      <div className="table-scroll"><table>
        <thead><tr><th>IP</th><th>Location</th><th>Why</th><th>Failed attempts</th><th>Since</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ip}>
              <td><code>{r.ip}</code></td>
              <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{r.place ?? <span style={{ color: '#8b98aa' }}>—</span>}{r.isp && <small style={{ display: 'block' }}>{r.isp}</small>}</td>
              <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{r.reason ?? '—'}<small style={{ display: 'block' }}>{r.auto ? 'Automatic' : r.by ? `By ${r.by}` : ''}</small></td>
              <td>{r.tries}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
              <td><button type="button" className="filter-button" disabled={pending} onClick={() => onRemove(r.ip)}><CircleCheck size={13} /> {removeLabel}</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 22, color: '#8b98aa' }}>{empty}</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}

function RuleForm({ init, onClose, onDone }: { init: { ip: string; kind: 'block' | 'allow' }; onClose: () => void; onDone: (m: string) => void }) {
  const [ip, setIp] = useState(init.ip)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const block = init.kind === 'block'
  return (
    <Modal title={block ? 'Block an IP' : 'Trust an IP'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await setIpRuleAction(ip, init.kind, reason || null); if (!r.ok) return setError(r.error); onDone(block ? `${r.data} blocked` : `${r.data} is trusted`) }) }}>
        <p className="section-hint" style={{ margin: '-8px 0 12px' }}>{block ? 'Nobody can sign in from this IP until you unblock it.' : 'Use for a branch office: its IP is never locked or blocked, so one person typing a wrong password cannot shut the whole office out.'}</p>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label>IP address<span className="required-mark">*</span><input required value={ip} onChange={(e) => setIp(e.target.value)} placeholder="e.g. 103.21.58.4" autoFocus={!init.ip} /></label>
          <label>{block ? 'Why (optional)' : 'Which office (optional)'}<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={block ? 'e.g. Repeated guessing on admin accounts' : 'e.g. Ludhiana branch office'} /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending || !ip.trim()}>{pending ? 'Saving…' : block ? 'Block' : 'Trust'}</button></div>
      </form>
    </Modal>
  )
}

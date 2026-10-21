import { Award, BadgeCheck, BookOpen, Building2, CalendarDays, Clock, Download, FileText, Hash, MonitorSmartphone, ShieldAlert, ShieldX } from 'lucide-react'
import { VerifyShell } from '@/components/verify-shell'
import { durationText, fmtCertDate } from '@/lib/cert-art'
import { verifyCertificate } from '@/modules/certificates/service'
import { requireRequestOrg } from '@/lib/tenant/request'
import { orgBrand } from '@/lib/brand'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Certificate verification' }

// Public page: anyone holding the link / QR code (or who found it on /verify) checks a certificate. It shows only what
// the certificate itself prints: who, which course and when, the numbers, and whether it stands.
export default async function VerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  const org = await requireRequestOrg()
  const v = await verifyCertificate(org.id, hash.toLowerCase())
  const brand = await orgBrand(org.id)
  const checked = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

  if (!v.found) return (
    <VerifyShell again>
      <style>{CSS}</style>
      <section className="vf-card">
        <div className="vr-band bad"><ShieldX size={30} /><div><strong>Not found</strong><span>No {brand.name} certificate matches this link. It may be mistyped, cut short, or not genuine.</span></div></div>
        <div className="vr-body"><p className="vr-muted">Check the link or scan the QR code on the certificate again, or search by its number on the <a href="/verify">verification page</a>.</p></div>
      </section>
    </VerifyShell>
  )

  const initials = v.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const rel = v.sheet.gender === 'male' ? 'Son of' : v.sheet.gender === 'female' ? 'Daughter of' : 'Son / Daughter of'
  const span = [fmtCertDate(v.joined), fmtCertDate(v.ended)].filter(Boolean).join(' – ')
  const facts: [typeof Award, string, string | null][] = [
    [BookOpen, 'Course', v.course],
    [Building2, 'Department', v.department],
    [CalendarDays, 'Course period', span || null],
    [Clock, 'Duration', durationText(v.durationWeeks, v.hours) || null],
    [MonitorSmartphone, 'Mode', v.sheet.mode],
    [Building2, 'Branch', v.branch],
    [Award, 'Certificate no.', v.certNo],
    [CalendarDays, 'Issued on', new Date(v.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })],
  ]
  return (
    <VerifyShell again>
      <style>{CSS}</style>
      <section className="vf-card">
        {v.revoked
          ? <div className="vr-band bad"><ShieldAlert size={30} /><div><strong>Certificate revoked</strong><span>This certificate was issued by {brand.name} but has been withdrawn and is no longer valid.</span></div></div>
          : <div className="vr-band ok"><BadgeCheck size={30} /><div><strong>Genuine certificate</strong><span>Issued by {brand.name} and valid · checked {checked}</span></div></div>}

        <div className="vr-person">
          <div className="vr-avatar" aria-hidden="true">{initials}</div>
          <div>
            <span className="vr-label">Awarded to</span>
            <h1>{v.name}</h1>
            {v.sheet.father && <p className="vr-muted">{rel} {v.sheet.father}</p>}
            <p className="vr-reg"><Hash size={14} /> Registration no. <b>{v.sheet.regNo}</b></p>
          </div>
        </div>

        <div className="vr-body">
          <dl className="vr-grid">
            {facts.filter(([, , x]) => x).map(([I, k, x]) => (
              <div key={k}><dt><I size={15} /> {k}</dt><dd>{x}</dd></div>
            ))}
          </dl>
          {v.modules.length > 0 && <div className="vr-chips"><span className="vr-label">{v.toolsLabel} covered</span><div>{v.modules.map((m) => <span key={m}>{m}</span>)}</div></div>}
          {v.projectCertificate && v.project?.title && <div className="vr-project"><span className="vr-label">Project</span><b>{v.project.title}</b>{v.project.tools.length > 0 && <small>{v.project.tools.join(' · ')}</small>}</div>}
          {v.revoked && v.revokedReason && <p className="vr-reason"><b>Reason:</b> {v.revokedReason}</p>}

          <div className="vf-actions vr-actions">
            <a className="vr-btn primary" href={`/verify/${hash}/certificate`}><FileText size={16} /> View certificate</a>
            <a className="vr-btn" href={`/verify/${hash}/certificate/pdf`}><Download size={16} /> Download PDF</a>
            {v.projectCertificate && <a className="vr-btn" href={`/verify/${hash}/certificate?kind=project`}><Award size={16} /> Project certificate</a>}
          </div>
          <p className="vr-code">Verification code {hash.slice(0, 12)}…{hash.slice(-6)} · this page is generated live from {brand.name}’s records.</p>
        </div>
      </section>
    </VerifyShell>
  )
}

const CSS = `
.vr-band { display: flex; gap: 14px; align-items: center; padding: 20px 26px; color: #fff; }
.vr-band.ok { background: linear-gradient(135deg, #059669, #10b981); }
.vr-band.bad { background: linear-gradient(135deg, #b91c1c, #ef4444); }
.vr-band strong { display: block; font-size: 20px; letter-spacing: -.3px; }
.vr-band span { display: block; margin-top: 2px; font-size: 13.5px; opacity: .92; }
.vr-person { display: flex; gap: 18px; align-items: center; padding: 24px 26px 18px; border-bottom: 1px solid #eef0f6; }
.vr-avatar { flex: none; width: 76px; height: 76px; display: grid; place-items: center; border-radius: 22px; background: linear-gradient(135deg, #10186a, #4a4af4); color: #fff; font-size: 26px; font-weight: 800; letter-spacing: .02em; }
.vr-person h1 { margin: 2px 0; font-size: 26px; letter-spacing: -.5px; }
.vr-label { display: block; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #8a93ad; }
.vr-muted { margin: 0; color: #556080; font-size: 14px; }
.vr-muted a { color: #4f46e5; }
.vr-reg { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; padding: 5px 11px; border-radius: 999px; background: #eef0ff; color: #3730a3; font-size: 13px; }
.vr-body { padding: 20px 26px 24px; display: grid; gap: 18px; }
.vr-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; }
.vr-grid > div { padding: 12px 14px; border: 1px solid #eef0f6; border-radius: 14px; background: #fafbff; }
.vr-grid dt { display: flex; align-items: center; gap: 6px; color: #8a93ad; font-size: 12px; font-weight: 700; }
.vr-grid dd { margin: 4px 0 0; font-size: 15px; font-weight: 700; color: #0f1437; overflow-wrap: anywhere; }
.vr-chips > div { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.vr-chips > div span { padding: 5px 11px; border-radius: 999px; background: #f1f5f9; color: #334155; font-size: 12.5px; font-weight: 600; }
.vr-project { padding: 14px; border-radius: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; }
.vr-project b { display: block; margin-top: 4px; font-size: 15px; }
.vr-project small { color: #4b5563; }
.vr-reason { margin: 0; padding: 12px 14px; border-radius: 12px; background: #fef2f2; color: #991b1b; }
.vr-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.vr-btn { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; border: 1.5px solid #d8dbea; border-radius: 12px; color: #10186a; font-size: 14px; font-weight: 700; text-decoration: none; background: #fff; }
.vr-btn.primary { border-color: transparent; background: linear-gradient(135deg, #10186a, #4a4af4); color: #fff; }
.vr-code { margin: 0; color: #9aa1bd; font-size: 11.5px; }
@media (max-width: 560px) { .vr-grid { grid-template-columns: 1fr; } .vr-person { padding: 20px 18px 16px; } .vr-body { padding: 18px; } .vr-band { padding: 18px; } .vr-person h1 { font-size: 22px; } .vr-avatar { width: 60px; height: 60px; font-size: 21px; } }
`

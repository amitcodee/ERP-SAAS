// The frame of the public verification pages (/verify, /verify/<code>, /verify/receipt/…): the techcadd logo on a
// navy band, one white card, and a plain footer. Server-rendered; no script needed.
export const VERIFY_CSS = `
.vf { min-height: 100vh; display: grid; justify-items: center; align-content: start; gap: 18px; padding: 0 14px 32px;
  background: radial-gradient(60% 50% at 10% 0%, #2a2fb8 0%, transparent 70%), linear-gradient(180deg, #10186a 0, #10186a 230px, #eef1f8 230px);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0f1437; }
.vf-top { width: 100%; max-width: 760px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 22px 4px 0; color: #fff; }
.vf-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: #fff; }
.vf-brand img { width: 132px; height: auto; padding: 8px 12px; background: #fff; border-radius: 12px; }
.vf-brand span { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; opacity: .85; }
.vf-top a.vf-again { color: #fff; font-size: 13px; font-weight: 600; text-decoration: none; padding: 8px 14px; border: 1px solid #ffffff55; border-radius: 999px; }
.vf-card { width: 100%; max-width: 760px; background: #fff; border-radius: 22px; box-shadow: 0 30px 70px -30px #0f143788; overflow: hidden; }
.vf-foot { max-width: 760px; text-align: center; color: #6b7394; font-size: 12px; line-height: 1.6; }
.vf-foot a { color: #4f46e5; }
@media print { .vf { background: #fff; } .vf-top a.vf-again, .vf-actions, .vf-foot { display: none; } .vf-card { box-shadow: none; border: 1px solid #ddd; } }
`

export function VerifyShell({ children, again = false }: { children: React.ReactNode; again?: boolean }) {
  return (
    <main className="vf">
      <style>{VERIFY_CSS}</style>
      <header className="vf-top">
        <a className="vf-brand" href="/verify"><img src="/tce-logo.png" alt="techcadd" /><span>Certificate verification</span></a>
        {again && <a className="vf-again" href="/verify">Verify another</a>}
      </header>
      {children}
      <footer className="vf-foot">
        techcadd Computer Education · this page is the official record of certificates issued by techcadd branches.<br />
        Questions about a certificate? <a href="/support">Contact techcadd</a>.
      </footer>
    </main>
  )
}

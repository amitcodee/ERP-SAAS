// The 404 page: a page that does not exist, or a record that is not there (or not yours to open). `inPanel` when it
// shows inside the panel's frame (sidebar and top bar around it); otherwise it stands alone.
import Link from 'next/link'
import { BackButton } from '@/components/back-button'

export function NotFoundView({ inPanel = false }: { inPanel?: boolean }) {
  return (
    <main className={`nf-page${inPanel ? ' in-panel' : ''}`}>
      <title>Page not found</title>
      <style>{`
        .nf-page { min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; background: radial-gradient(circle at 20% 10%, #e9ebff 0, transparent 45%), radial-gradient(circle at 85% 90%, #fde7f0 0, transparent 40%), var(--page, #f3f4fc); }
        .nf-page.in-panel { min-height: calc(100vh - 140px); background: none; }
        .nf-card { width: min(560px, 100%); text-align: center; }
        .nf-logo { display: inline-block; margin-bottom: 18px; }
        .nf-art { width: min(320px, 80%); height: auto; margin: 0 auto 8px; display: block; }
        .nf-code { margin: 0; font-size: clamp(64px, 14vw, 104px); line-height: 1; font-weight: 800; letter-spacing: -2px; background: linear-gradient(90deg, var(--navy, #10186a), #4a4af4 60%, #8b5cf6); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .nf-card h1 { margin: 8px 0 8px; font-size: 24px; color: var(--ink, #0f1437); }
        .nf-card p { margin: 0 auto 24px; max-width: 420px; color: var(--muted, #6b7394); font-size: 15px; line-height: 1.6; }
        .nf-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .nf-hint { margin-top: 26px; font-size: 12.5px; color: var(--faint, #9aa1bd); }
        .nf-float { animation: nf-float 4s ease-in-out infinite; transform-origin: center; }
        .nf-spin { animation: nf-spin 6s ease-in-out infinite; transform-origin: 160px 104px; }
        @keyframes nf-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes nf-spin { 0%, 100% { transform: rotate(-18deg); } 50% { transform: rotate(24deg); } }
        @media (prefers-reduced-motion: reduce) { .nf-float, .nf-spin { animation: none; } }
      `}</style>
      <div className="nf-card">
        {/* a lost compass over a page with a question mark */}
        <svg className="nf-art" viewBox="0 0 320 200" role="img" aria-label="A compass that has lost its way">
          <ellipse cx="160" cy="186" rx="110" ry="9" fill="#10186a" opacity=".08" />
          <g className="nf-float">
            <rect x="96" y="44" width="128" height="128" rx="14" fill="#fff" stroke="#e1e4f5" strokeWidth="2" />
            <rect x="114" y="64" width="62" height="8" rx="4" fill="#e8eaf6" />
            <rect x="114" y="80" width="92" height="8" rx="4" fill="#eef0ff" />
            <rect x="114" y="96" width="78" height="8" rx="4" fill="#eef0ff" />
            <text x="160" y="152" textAnchor="middle" fontSize="38" fontWeight="800" fill="#c7cbea">?</text>
          </g>
          <g className="nf-float" style={{ animationDelay: '-1.2s' }}>
            <circle cx="160" cy="104" r="44" fill="#10186a" />
            <circle cx="160" cy="104" r="36" fill="#fff" />
            <circle cx="160" cy="104" r="36" fill="none" stroke="#e8eaf6" strokeWidth="2" strokeDasharray="2 8" />
            <text x="160" y="76" textAnchor="middle" fontSize="10" fontWeight="700" fill="#10186a">N</text>
            <g className="nf-spin">
              <path d="M160 76 L167 104 L160 104 Z" fill="#f43f5e" />
              <path d="M160 76 L153 104 L160 104 Z" fill="#e11d48" />
              <path d="M160 132 L153 104 L160 104 Z" fill="#c7cbea" />
              <path d="M160 132 L167 104 L160 104 Z" fill="#aab0d6" />
            </g>
            <circle cx="160" cy="104" r="4" fill="#10186a" />
          </g>
          <circle cx="62" cy="58" r="5" fill="#8b5cf6" opacity=".5" /><circle cx="262" cy="70" r="4" fill="#f59e0b" opacity=".6" />
          <circle cx="248" cy="150" r="6" fill="#4a4af4" opacity=".35" /><circle cx="74" cy="140" r="3.5" fill="#10b981" opacity=".55" />
        </svg>
        <p className="nf-code" aria-hidden>404</p>
        <h1>This page has wandered off</h1>
        <p>The page you are looking for does not exist, was moved, or the record is not there any more. Check the address, or head back and pick it from the menu.</p>
        <div className="nf-actions">
          <Link href="/" className="button primary">Go to home</Link>
          <BackButton />
        </div>
        <div className="nf-hint">If you followed a link inside the panel to get here, tell your branch admin which one.</div>
      </div>
    </main>
  )
}

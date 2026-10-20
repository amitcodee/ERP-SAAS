import Image from 'next/image'
import Link from 'next/link'

/** The split layout shared by the sign-in and password-reset pages: art panel on the left, logo + form on the right. */
export function AuthShell({ tagline, children }: { tagline: string; children: React.ReactNode }) {
  return (
    <main className="login-page">
      <aside className="login-art" aria-hidden="true">
        <svg className="login-waves" viewBox="0 0 600 900" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lw-a" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#5b6cff" /><stop offset=".5" stopColor="#2f3bd1" /><stop offset="1" stopColor="#7aa2ff" />
            </linearGradient>
            <linearGradient id="lw-b" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#1a1f71" /><stop offset=".55" stopColor="#2a38c4" /><stop offset="1" stopColor="#38bdf8" />
            </linearGradient>
            <linearGradient id="lw-c" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#141858" /><stop offset="1" stopColor="#2331a8" />
            </linearGradient>
            <filter id="lw-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14" /></filter>
            <filter id="lw-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          <g filter="url(#lw-blur)" fill="none" strokeLinecap="round">
            <path d="M-60 250 C 120 40, 380 60, 680 150" stroke="url(#lw-a)" strokeWidth="150" />
            <path d="M-60 400 C 160 200, 400 250, 680 330" stroke="url(#lw-b)" strokeWidth="140" opacity=".95" />
            <path d="M-60 560 C 180 400, 420 470, 680 560" stroke="url(#lw-c)" strokeWidth="120" opacity=".9" />
          </g>
          <g filter="url(#lw-soft)" fill="none" strokeLinecap="round" opacity=".55">
            <path d="M-60 190 C 130 20, 380 30, 680 110" stroke="#c7d2fe" strokeWidth="3" />
            <path d="M-60 290 C 140 100, 390 120, 680 215" stroke="#070a2e" strokeWidth="5" />
            <path d="M-60 345 C 150 160, 400 190, 680 275" stroke="#a5b4fc" strokeWidth="2" />
            <path d="M-60 440 C 170 260, 410 300, 680 385" stroke="#070a2e" strokeWidth="5" />
            <path d="M-60 490 C 175 320, 415 370, 680 450" stroke="#7dd3fc" strokeWidth="2" />
            <path d="M-60 600 C 190 450, 425 510, 680 600" stroke="#60a5fa" strokeWidth="2" />
          </g>
        </svg>
        <div className="login-art-top"><span>Welcome</span><i /></div>
        <div className="login-art-bottom">
          <h2>Your Skill &amp;<br />Technology<br />Partner</h2>
          <p>{tagline}</p>
        </div>
      </aside>

      <section className="login-side">
        <Image className="login-logo" src="/tce.webp" alt="techcadd — Your Skill & Technology Partner" width={940} height={270} priority />
        {children}
        <p className="login-foot">© techcadd · <Link href="/">Help &amp; Support</Link></p>
      </section>
    </main>
  )
}

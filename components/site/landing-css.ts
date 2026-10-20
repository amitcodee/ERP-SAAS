// The public pages' look (the institute's own home page /support, and the platform's marketing site): one stylesheet,
// scoped under .lp.
export const LANDING_CSS = `
.lp { --navy: #10186a; --ink: #0f1437; --text: #4a5170; --muted: #7a82a3; --line: #e6e8f3; --indigo: #4a4af4; --lime: #c9f74a; --soft: #f5f6fc;
  background: #fff; color: var(--ink); font-size: 15px; line-height: 1.6; overflow-x: hidden; }
.lp * { box-sizing: border-box; }
.lp h1, .lp h2, .lp h3 { font-family: inherit; letter-spacing: -.02em; margin: 0; }
.lp-wrap { width: 100%; max-width: 1180px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 32px); }
.lp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 22px; border-radius: 12px; font-size: 14.5px; font-weight: 700; text-decoration: none; white-space: nowrap; transition: transform .15s, box-shadow .15s, background .15s; }
.lp-btn:hover { transform: translateY(-2px); }
.lp-btn-dark { background: var(--navy); color: #fff; box-shadow: 0 12px 26px -12px #10186aaa; }
.lp-btn-lime { background: var(--lime); color: var(--navy); box-shadow: 0 14px 30px -12px #c9f74a99; }
.lp-btn-ghost { border: 1.5px solid #ffffff4d; color: #fff; background: #ffffff12; }
.lp-eyebrow { display: inline-block; margin-bottom: 10px; color: var(--indigo); font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.lp-head { max-width: 680px; margin-bottom: 36px; }
.lp-head h2 { font-size: clamp(28px, 3.6vw, 40px); line-height: 1.12; font-weight: 800; }
.lp-head p { margin: 12px 0 0; color: var(--text); font-size: 16px; }
.lp-head-light h2 { color: #fff; }
.lp-head-light .lp-eyebrow { color: var(--lime); }
.lp-sec { padding: clamp(56px, 8vw, 96px) 0; }
.lp-soft { background: var(--soft); }
.lp-ico { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 15px; background: linear-gradient(135deg, var(--navy), var(--indigo)); color: #fff; flex: none; }
.lp-ico-sm { width: 40px; height: 40px; border-radius: 12px; }
.lp-ico-glass { background: #ffffff1a; border: 1px solid #ffffff2e; }

/* top bar */
.lp-nav { position: sticky; top: 0; z-index: 20; background: #ffffffe6; backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.lp-nav-in { display: flex; align-items: center; gap: 24px; height: 68px; }
.lp-logo img { width: 128px; height: auto; display: block; }
.lp-nav nav { display: flex; gap: 26px; margin-left: auto; }
.lp-nav nav a { color: var(--text); font-size: 14px; font-weight: 600; text-decoration: none; }
.lp-nav nav a:hover { color: var(--navy); }
.lp-nav .lp-btn { height: 42px; }

/* hero */
.lp-hero { position: relative; padding: clamp(48px, 7vw, 88px) 0 clamp(64px, 9vw, 110px); color: #fff;
  background: radial-gradient(50% 70% at 85% 10%, #4a4af455 0%, transparent 70%), radial-gradient(40% 60% at 0% 100%, #5cc8ff33 0%, transparent 70%), linear-gradient(160deg, #0a0f4d 0%, #10186a 55%, #1b2490 100%); }
.lp-hero-in { display: grid; grid-template-columns: 1.05fr 1fr; gap: clamp(28px, 5vw, 64px); align-items: center; }
.lp-pill { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: #ffffff14; border: 1px solid #ffffff26; color: #dfe3ff; font-size: 13px; font-weight: 600; }
.lp-pill svg { color: var(--lime); }
.lp-hero h1 { margin: 20px 0 18px; font-size: clamp(36px, 5.4vw, 60px); line-height: 1.04; font-weight: 800; letter-spacing: -.035em; }
.lp-hero h1 span { color: var(--lime); }
.lp-hero-copy > p { margin: 0; max-width: 540px; color: #c9cdf2; font-size: 17px; }
.lp-hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.lp-hero-ticks { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 24px 0 0; padding: 0; list-style: none; color: #b8bdea; font-size: 13.5px; }
.lp-hero-ticks li { display: inline-flex; align-items: center; gap: 6px; }
.lp-hero-ticks svg { color: var(--lime); }
.lp-shot { position: relative; border-radius: 18px; background: #fff; color: var(--ink); box-shadow: 0 40px 90px -30px #000a, 0 0 0 1px #ffffff22; transform: perspective(1600px) rotateY(-8deg) rotateX(2deg); }
.lp-shot-bar { display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.lp-shot-bar i { width: 10px; height: 10px; border-radius: 50%; background: #e2e4ef; }
.lp-shot-bar span { margin-left: 10px; color: var(--muted); font-size: 12px; font-weight: 700; }
.lp-shot-body { padding: 16px; display: grid; gap: 12px; }
.lp-shot-greet { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-radius: 12px; background: linear-gradient(120deg, var(--navy), var(--indigo)); color: #fff; }
.lp-shot-greet b { font-size: 14px; } .lp-shot-greet em { font-style: normal; font-size: 11px; padding: 3px 9px; border-radius: 999px; background: #ffffff26; }
.lp-shot-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.lp-shot-kpis div { position: relative; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; }
.lp-shot-kpis small { display: block; color: var(--muted); font-size: 10.5px; font-weight: 700; }
.lp-shot-kpis b { display: block; width: 60%; height: 14px; margin-top: 6px; border-radius: 4px; background: #dfe2f5; }
.lp-shot-kpis .up { position: absolute; right: 10px; top: 10px; color: #16a34a; font-size: 10px; }
.lp-shot-chart { display: flex; align-items: flex-end; gap: 8px; height: 110px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; }
.lp-shot-chart i { flex: 1; border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg, var(--indigo), #9fa5ff); }
.lp-shot-chart i:last-child { background: linear-gradient(180deg, var(--navy), var(--indigo)); }
.lp-shot-rows { display: grid; gap: 6px; }
.lp-shot-rows div { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: var(--soft); font-size: 12px; }
.lp-shot-rows em { font-style: normal; color: var(--text); font-weight: 600; flex: 1; }
.lp-shot-rows b { width: 52px; height: 8px; border-radius: 4px; background: #dfe2f5; }
.lp-shot-rows .d { width: 9px; height: 9px; border-radius: 50%; } .d0 { background: #f59e0b; } .d1 { background: var(--indigo); } .d2 { background: #16a34a; }
.lp-shot-float { position: absolute; left: -26px; bottom: -22px; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 14px; background: #fff; box-shadow: 0 20px 40px -16px #0f143788; color: #047857; }
.lp-shot-float b { display: block; color: var(--ink); font-size: 13px; } .lp-shot-float small { color: var(--muted); font-size: 11.5px; }

/* who it is for */
.lp-aud { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.lp-aud-card { display: grid; align-content: start; gap: 10px; padding: 28px 26px; border: 1px solid var(--line); border-radius: 22px; background: #fff; color: inherit; text-decoration: none; transition: transform .15s, box-shadow .15s, border-color .15s; }
.lp-aud-card:hover { transform: translateY(-5px); border-color: #c9ccf5; box-shadow: 0 30px 60px -32px #10186a77; }
.lp-tag { margin-top: 6px; color: var(--indigo); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.lp-aud-card h3 { font-size: 21px; font-weight: 800; color: var(--navy); }
.lp-aud-card ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; color: var(--text); font-size: 14px; }
.lp-aud-card li { display: flex; gap: 8px; align-items: flex-start; } .lp-aud-card li svg { flex: none; margin-top: 3px; color: #16a34a; }
.lp-more { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--indigo); font-weight: 800; font-size: 14px; }

/* journey */
.lp-journey { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin: 0; padding: 0; list-style: none; }
.lp-journey::before { content: ''; position: absolute; left: 6%; right: 6%; top: 21px; height: 2px; background: linear-gradient(90deg, var(--indigo), var(--lime)); opacity: .5; }
.lp-journey li { position: relative; display: grid; justify-items: center; gap: 8px; text-align: center; }
.lp-jn { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: #fff; border: 2px solid var(--indigo); color: var(--navy); font-weight: 800; position: relative; z-index: 1; }
.lp-journey b { font-size: 15px; color: var(--navy); } .lp-journey small { color: var(--muted); font-size: 12.5px; line-height: 1.4; }

/* features */
.lp-bento { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.lp-feat { display: grid; align-content: start; gap: 10px; padding: 22px; border: 1px solid var(--line); border-radius: 18px; background: #fff; }
.lp-feat h3 { font-size: 16px; font-weight: 800; color: var(--navy); }
.lp-feat p { margin: 0; color: var(--text); font-size: 13.5px; }
.lp-feat.big { grid-column: span 2; padding: 28px; background: linear-gradient(135deg, #f3f4ff, #fff 70%); }
.lp-feat.big h3 { font-size: 21px; } .lp-feat.big p { font-size: 15px; max-width: 460px; }

/* security */
.lp-dark { padding: clamp(56px, 8vw, 92px) 0; color: #fff; background: radial-gradient(40% 80% at 100% 0%, #4a4af455, transparent 70%), linear-gradient(160deg, #0a0f4d, #10186a); }
.lp-sec4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.lp-sec4 > div { padding: 24px; border-radius: 18px; background: #ffffff0d; border: 1px solid #ffffff1f; }
.lp-sec4 h3 { margin-top: 14px; font-size: 17px; font-weight: 800; }
.lp-sec4 p { margin: 6px 0 0; color: #c2c7ee; font-size: 14px; }

/* verify */
.lp-verify { display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; align-items: center; padding: clamp(28px, 4vw, 48px); border-radius: 28px; background: linear-gradient(120deg, #eef0ff, #e8fbf3); border: 1px solid #dfe3fb; }
.lp-verify h2 { font-size: clamp(26px, 3vw, 34px); font-weight: 800; line-height: 1.15; }
.lp-verify-text p { margin: 14px 0 22px; color: var(--text); font-size: 15.5px; }
.lp-verify-card { border-radius: 20px; background: #fff; box-shadow: 0 30px 60px -30px #10186a66; overflow: hidden; }
.lp-verify-card .ok { display: flex; align-items: center; gap: 8px; padding: 14px 18px; background: linear-gradient(135deg, #059669, #10b981); color: #fff; font-weight: 800; }
.lp-verify-card .who { display: flex; gap: 12px; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.lp-verify-card .who span { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 14px; background: linear-gradient(135deg, var(--navy), var(--indigo)); color: #fff; font-weight: 800; }
.lp-verify-card .who b { display: block; } .lp-verify-card small { color: var(--muted); font-size: 12px; }
.lp-verify-card .rows { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 16px 18px; }
.lp-verify-card .rows div { padding: 10px 12px; border-radius: 12px; background: var(--soft); } .lp-verify-card .rows b { display: block; font-size: 13.5px; }

/* help */
.lp-start { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 40px; }
.lp-start > div { display: grid; grid-template-columns: auto auto 1fr; grid-template-rows: auto auto; align-items: center; column-gap: 12px; padding: 18px; border: 1px solid var(--line); border-radius: 16px; background: #fff; }
.lp-start .lp-jn { grid-row: span 2; width: 38px; height: 38px; }
.lp-start svg { color: var(--indigo); } .lp-start b { color: var(--navy); }
.lp-start small { grid-column: 2 / 4; color: var(--text); font-size: 13px; }
.lp-help { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.lp-sub { margin-bottom: 14px !important; font-size: 18px; font-weight: 800; color: var(--navy); }
.lp-acc { display: grid; gap: 10px; }
.lp-acc details { border: 1px solid var(--line); border-radius: 14px; background: #fff; }
.lp-acc summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 15px 18px; cursor: pointer; font-weight: 700; color: var(--ink); list-style: none; }
.lp-acc summary::-webkit-details-marker { display: none; }
.lp-acc summary::after { content: '+'; flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; background: var(--soft); color: var(--indigo); font-weight: 800; }
.lp-acc details[open] summary::after { content: '−'; }
.lp-acc summary em { margin-left: auto; font-style: normal; padding: 3px 9px; border-radius: 999px; background: #eef0ff; color: var(--indigo); font-size: 11px; font-weight: 800; white-space: nowrap; }
.lp-acc details p, .lp-acc details ol { margin: 0; padding: 0 18px 16px; color: var(--text); font-size: 14px; }
.lp-acc details ol { padding-left: 38px; display: grid; gap: 4px; }

/* closing call */
.lp-cta { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: clamp(28px, 4vw, 48px); border-radius: 28px; color: #fff; background: radial-gradient(40% 90% at 100% 0%, #4a4af466, transparent 70%), linear-gradient(120deg, #0a0f4d, #10186a); }
.lp-cta h2 { font-size: clamp(26px, 3vw, 34px); font-weight: 800; } .lp-cta p { margin: 8px 0 0; color: #c2c7ee; max-width: 520px; }
.lp-cta-btns { display: flex; gap: 12px; flex-wrap: wrap; }

/* footer */
.lp-foot { padding: 48px 0 28px; border-top: 1px solid var(--line); background: #fafbff; }
.lp-foot-in { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 28px; }
.lp-foot-brand img { width: 140px; height: auto; } .lp-foot-brand p { margin: 12px 0 0; color: var(--muted); font-size: 13.5px; max-width: 300px; }
.lp-foot h4 { margin: 0 0 10px; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--navy); }
.lp-foot-in > div:not(.lp-foot-brand) { display: grid; gap: 8px; align-content: start; }
.lp-foot a { color: var(--text); text-decoration: none; font-size: 14px; } .lp-foot a:hover { color: var(--indigo); }
.lp-copy { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12.5px; }

/* smaller screens */
@media (max-width: 1000px) {
  .lp-hero-in, .lp-verify { grid-template-columns: 1fr; }
  .lp-shot { transform: none; max-width: 560px; }
  .lp-bento { grid-template-columns: repeat(2, 1fr); }
  .lp-sec4 { grid-template-columns: repeat(2, 1fr); }
  .lp-journey { grid-template-columns: repeat(3, 1fr); row-gap: 28px; } .lp-journey::before { display: none; }
  .lp-foot-in { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 760px) {
  .lp-nav nav { display: none; } .lp-nav .lp-btn { margin-left: auto; }
  .lp-aud, .lp-start, .lp-help { grid-template-columns: 1fr; }
  .lp-shot-float { left: 10px; }
}
@media (max-width: 520px) {
  .lp-bento, .lp-sec4 { grid-template-columns: 1fr; } .lp-feat.big { grid-column: auto; }
  .lp-journey { grid-template-columns: repeat(2, 1fr); }
  .lp-foot-in { grid-template-columns: 1fr; }
  .lp-hero-cta .lp-btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .lp-btn, .lp-aud-card { transition: none; } }
`

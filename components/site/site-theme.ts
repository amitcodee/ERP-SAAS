// The platform's public site look (the apex domain only; the institute's own home page keeps LANDING_CSS as it is).
// A clean, roomy business-software look: white pages and light grey bands, near-black headings, a warm yellow brand
// colour (near-black text on it; a deep amber for coloured words on white), teal for small ticks, a yellow brush stroke
// under the words that matter, handwritten notes with a curved arrow (Caveat), a grid of colourful app tiles, a dark
// footer. Loaded after LANDING_CSS by SiteShell and SiteAuth.
const STROKE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 24' preserveAspectRatio='none'%3E%3Cpath d='M4 15 C 70 7, 160 5, 296 11 L 294 20 C 170 14, 80 16, 6 22 Z' fill='%23fbb945'/%3E%3C/svg%3E")`

export const SITE_THEME = `
.lp.sx { --ink: #1f2128; --navy: #1f2128; --text: #4c5260; --muted: #8a8f9c; --line: #e5e7eb; --paper: #f7f7f9; --soft: #f7f7f9;
  --brand: #ffc21a; --brand-d: #f2b200; --brand-soft: #fff6d9; --brand-text: #a36500; --brand-ink: #1f2128; --teal: #017e84; --teal-d: #01666b; --teal-soft: #e3f3f3; --sun: #fbb945;
  --leaf: #017e84; --leaf-d: #01666b; --leaf-soft: #e3f3f3; --mari: #fbb945; --mari-soft: #fff4dc; --indigo: #ffc21a; --lime: #fbb945;
  --green: #017e84; --green-d: #01666b; --green-soft: #e3f3f3;
  background: #fff; font-family: var(--font-site), var(--font-sans), system-ui, sans-serif; color: var(--ink); font-size: 16px; }
.lp.sx h1, .lp.sx h2, .lp.sx h3, .sx .site-h1 { font-family: var(--font-site), sans-serif; letter-spacing: -.025em; text-wrap: balance; color: var(--ink); }
.sx a { color: inherit; }
.sx .hl { position: relative; z-index: 0; white-space: nowrap; }
.sx .hl::after { content: ''; position: absolute; z-index: -1; left: -.06em; right: -.06em; bottom: -.02em; height: .42em; background: ${STROKE} center / 100% 100% no-repeat; }
.sx .hl.brand { color: var(--brand-text); }
.sx mark, .sx .mk { color: inherit; background: none; position: relative; z-index: 0; }
.sx mark::after, .sx .mk::after { content: ''; position: absolute; z-index: -1; left: -.04em; right: -.04em; bottom: 0; height: .38em; background: ${STROKE} center / 100% 100% no-repeat; }
.sx .hand { font-family: var(--font-hand), cursive; font-weight: 600; color: var(--teal); font-size: 25px; line-height: 1.1; }
.sx-note { display: inline-flex; align-items: flex-start; gap: 6px; }
.sx-note svg { flex: none; color: var(--teal); }

/* buttons: yellow first (dark text), light grey second */
.sx .lp-btn { height: 46px; padding: 0 22px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: none; gap: 8px; transition: background .15s, transform .15s, border-color .15s; }
.sx .lp-btn:hover { transform: none; }
.sx .lp-btn svg { width: 16px; height: 16px; flex: none; }
.sx-btn-green, .sx .lp-btn-lime, .sx .lp-btn-dark, .sx-btn-brand { background: var(--brand); color: var(--brand-ink) !important; border: 0; }
.sx-btn-green:hover, .sx .lp-btn-lime:hover, .sx .lp-btn-dark:hover, .sx-btn-brand:hover { background: var(--brand-d); }
.sx-btn-line, .sx .lp-btn-ghost { background: #eef0f3; color: var(--ink) !important; border: 0; }
.sx-btn-line:hover, .sx .lp-btn-ghost:hover { background: #e2e5ea; }
.sx-btn-white { background: #fff; color: var(--ink) !important; border: 0; } .sx-btn-white:hover { background: #fff6d9; }
.sx-btn-teal { background: var(--teal); color: #fff !important; border: 0; } .sx-btn-teal:hover { background: var(--teal-d); }
.sx .lp-btn-lg { height: 54px; padding: 0 28px; font-size: 17px; border-radius: 10px; }

/* the top bar */
.sx .lp-nav { position: sticky; top: 0; background: #ffffffeb; backdrop-filter: blur(12px); border-bottom: 1px solid transparent; transition: border-color .2s; }
.sx .lp-nav { border-bottom-color: var(--line); }
.sx .lp-nav-in { height: 64px; gap: 36px; }
.sx .lp-nav nav { gap: 4px; margin-left: 0; margin-right: auto; }
.sx .lp-nav nav a { color: var(--ink); font-weight: 500; font-size: 15px; padding: 8px 12px; border-radius: 8px; }
.sx .lp-nav nav a:hover { background: var(--paper); color: var(--brand-text); }
.sx-nav-cta { display: flex; gap: 6px; align-items: center; } .sx-nav-cta .lp-btn { height: 40px; padding: 0 18px; font-size: 14.5px; }
.sx-signin { color: var(--ink); font-weight: 500; font-size: 15px; text-decoration: none; padding: 8px 12px; border-radius: 8px; } .sx-signin:hover { background: var(--paper); color: var(--brand-text); }
.sx .site-logo { color: var(--ink); } .sx .site-logo b { font-weight: 800; letter-spacing: -.035em; font-size: 22px; white-space: nowrap; color: var(--ink); }
.sx-logo-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: var(--brand); color: var(--brand-ink); flex: none; }
.sx .lp-ico { background: var(--brand-soft); color: var(--brand-text); border-radius: 10px; }
.sx .lp-ico.teal { background: var(--teal-soft); color: var(--teal); }

/* hero: centred, big words, two buttons, a handwritten note */
.sx-hero { position: relative; padding: clamp(56px, 9vw, 120px) 0 clamp(40px, 6vw, 72px); text-align: center; overflow: hidden; }
.sx-hero h1 { max-width: 920px; margin: 0 auto; font-size: clamp(40px, 6.4vw, 76px); line-height: 1.04; font-weight: 800; letter-spacing: -.04em; }
.sx-hero p.lead { margin: 22px auto 0; max-width: 620px; color: var(--text); font-size: clamp(18px, 2vw, 24px); line-height: 1.4; }
.sx-hero p.lead b { color: var(--ink); font-weight: 600; }
.sx-hero-cta { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
.sx-hero-note { position: relative; display: flex; justify-content: center; margin-top: 18px; }
.sx-hero-note .sx-note { margin-left: 180px; text-align: left; }
.sx-hero-note .hand { max-width: 320px; }

/* the app tiles */
.sx-apps-band { padding: clamp(48px, 7vw, 88px) 0; background: var(--paper); }
.sx-apps-band .sx-head { margin-bottom: 40px; }
.sx-apps { display: grid; grid-template-columns: repeat(6, 1fr); gap: 32px 12px; max-width: 860px; margin: 0 auto; }
.sx-app { display: grid; justify-items: center; gap: 10px; text-decoration: none; color: var(--ink); font-size: 14px; font-weight: 500; text-align: center; }
.sx-app span { width: 76px; height: 76px; display: grid; place-items: center; border-radius: 18px; background: #fff; box-shadow: 0 1px 2px #0000000d, 0 8px 20px -10px #1f212833; transition: transform .2s, box-shadow .2s; }
.sx-app span svg { width: 36px; height: 36px; }
.sx-app:hover span { transform: translateY(-4px); box-shadow: 0 2px 4px #0000000d, 0 16px 28px -12px #1f212855; }
.sx-apps-more { margin-top: 36px; text-align: center; }

/* section headings */
.sx-head { max-width: 780px; margin: 0 auto 44px; text-align: center; }
.sx-head h2 { font-size: clamp(30px, 4.2vw, 48px); line-height: 1.1; font-weight: 800; letter-spacing: -.035em; }
.sx-head h2 .g { color: var(--brand-text); }
.sx-head p { margin: 14px auto 0; max-width: 620px; color: var(--text); font-size: 18px; }
.sx-eyebrow { display: inline-block; margin-bottom: 10px; color: var(--teal); font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.sx .lp-sec { padding: clamp(56px, 8vw, 104px) 0; }
.sx .lp-soft { background: var(--paper); }

/* feature rows: words on one side, a picture of the screen on the other */
.sx-rows { display: grid; gap: clamp(56px, 8vw, 104px); }
.sx-row { display: grid; grid-template-columns: 1fr 1.05fr; gap: clamp(28px, 6vw, 80px); align-items: center; }
.sx-row.flip .sx-row-text { order: 2; }
.sx-row > *, .sx-tab-body > * { min-width: 0; }
.sx-row-text h3 { font-size: clamp(26px, 3vw, 36px); line-height: 1.12; font-weight: 800; letter-spacing: -.03em; }
.sx-row-text > p { margin: 14px 0 0; color: var(--text); font-size: 17px; }
.sx-row-text .lp-btn { margin-top: 26px; }
.sx-list { display: grid; gap: 14px; margin: 24px 0 0; padding: 0; list-style: none; }
.sx-list li { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; }
.sx-list .i { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: var(--teal-soft); color: var(--teal); margin-top: 1px; }
.sx-list b { display: block; font-weight: 600; color: var(--ink); } .sx-list small { display: block; color: var(--text); font-size: 14.5px; }
.sx-panel { position: relative; padding: clamp(22px, 4vw, 44px); border-radius: 20px; background: var(--brand-soft); }
.sx-row:nth-child(2n) .sx-panel { background: var(--teal-soft); }
.sx-panel .sx-card { transform: rotate(-1.2deg); }
.sx-card { display: grid; gap: 10px; padding: 18px; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px #0000000f, 0 24px 48px -28px #1f212866; }
.sx-card h4 { display: flex; justify-content: space-between; align-items: center; margin: 0 0 4px; font-size: 15px; font-weight: 700; color: var(--ink); }
.sx-card h4 em { font-style: normal; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-text); }
.sx-line { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--paper); font-size: 14px; }
.sx-line span { flex: 1; min-width: 0; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .sx-line b { font-size: 13px; color: var(--text); font-weight: 600; white-space: nowrap; }
.sx-line .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--teal); flex: none; } .sx-line .dot.o { background: var(--sun); } .sx-line .dot.r { background: #e5533d; }
.sx-bubble { padding: 12px 14px; border-radius: 12px 12px 12px 3px; background: #e7f8e3; font-size: 14px; color: #1f2d28; }
.sx-bubble small { display: block; text-align: right; color: #6b7a74; font-size: 11.5px; margin-top: 4px; }
.sx-receipt { display: grid; gap: 2px; padding: 14px; border: 1.5px dashed var(--line); border-radius: 12px; text-align: center; }
.sx-receipt small { color: var(--muted); font-size: 12.5px; } .sx-receipt .amt { font-size: 30px; font-weight: 800; letter-spacing: -.03em; color: var(--ink); }
.sx-cert { display: grid; justify-items: center; gap: 4px; padding: 22px 18px; border: 3px double var(--brand); border-radius: 10px; text-align: center; }
.sx-cert small { font-size: 11px; letter-spacing: .14em; color: var(--muted); font-weight: 700; } .sx-cert i { font-family: var(--font-hand), cursive; font-size: 34px; color: var(--brand-text); font-style: normal; font-weight: 700; } .sx-cert b { margin-top: 6px; color: var(--ink); }
.sx-tag { position: absolute; right: 18px; bottom: -16px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; background: #fff; color: var(--ink); font-size: 13.5px; font-weight: 600; box-shadow: 0 12px 28px -14px #1f212877; }
.sx-tag svg { color: var(--teal); }

/* who it is for */
.sx-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.sx-chips span { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; background: #fff; border: 1px solid var(--line); font-weight: 500; font-size: 15px; }
.sx-chips svg { color: var(--brand-text); }

/* small feature grid, integrations, safety, steps */
.sx-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px 40px; }
.sx-grid h3 { margin: 14px 0 6px; font-size: 18px; font-weight: 700; } .sx-grid p { margin: 0; color: var(--text); font-size: 15px; }
.sx-integ { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.sx-integ > div { display: grid; gap: 6px; align-content: start; padding: 20px; border-radius: 14px; background: #fff; border: 1px solid var(--line); }
.sx-integ b { margin-top: 6px; font-weight: 700; } .sx-integ small { color: var(--text); font-size: 14px; line-height: 1.5; }
.sx-dark { background: #262833; color: #fff; }
.lp.sx .sx-dark h2, .lp.sx .sx-dark h3 { color: #fff; } .sx-dark .sx-head p, .sx-dark p { color: #b9bcc6; } .sx-dark .sx-head h2 .g { color: var(--brand); }
.sx-safe { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.sx-safe > div { padding: 24px; border-radius: 14px; background: #ffffff0a; border: 1px solid #ffffff17; }
.sx-safe h3 { margin: 14px 0 6px; font-size: 17px; font-weight: 700; } .sx-safe p { margin: 0; font-size: 14.5px; }
.sx-dark .lp-ico { background: #ffffff12; color: var(--brand); }
.sx-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; counter-reset: s; }
.sx-steps > div { position: relative; padding: 28px; border-radius: 16px; background: #fff; border: 1px solid var(--line); }
.sx-steps .n { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--brand); color: var(--brand-ink); font-weight: 800; font-size: 18px; }
.sx-steps h3 { margin: 16px 0 6px; font-size: 20px; font-weight: 700; } .sx-steps p { margin: 0; color: var(--text); font-size: 15px; }

/* the closing band */
.sx-band { position: relative; padding: clamp(44px, 7vw, 80px) clamp(22px, 5vw, 64px); border-radius: 24px; background: var(--brand); text-align: center; overflow: hidden; }
.sx-band h2 { color: var(--brand-ink) !important; font-size: clamp(30px, 4.4vw, 52px); line-height: 1.08; font-weight: 800; letter-spacing: -.035em; }
.sx-band h2 .mk::after { filter: brightness(0) invert(1); opacity: .85; }
.sx-band p { margin: 16px auto 0; max-width: 600px; color: #4a3a12; font-size: 18px; }
.sx-cta { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.sx-band .lp-btn-ghost { background: #1f212814; color: var(--brand-ink) !important; } .sx-band .lp-btn-ghost:hover { background: #1f212824; }
.sx-band .hand { color: var(--brand-ink); }
.sx-band .sx-btn-white { background: var(--ink); color: #fff !important; } .sx-band .sx-btn-white:hover { background: #000; }

/* FAQ and guides */
.sx .lp-acc { display: grid; gap: 0; border-top: 1px solid var(--line); margin-left: auto; margin-right: auto; }
.sx .sx-page-body .lp-sub { max-width: 820px; margin-left: auto; margin-right: auto; }
.sx .lp-acc details { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; padding: 0; box-shadow: none; }
.sx .lp-acc summary { padding: 20px 4px; font-size: 17px; font-weight: 600; color: var(--ink); cursor: pointer; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.sx .lp-acc summary::-webkit-details-marker { display: none; }
.sx .lp-acc summary::after { content: '+'; flex: none; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: var(--paper); color: var(--brand-text); font-size: 20px; font-weight: 500; line-height: 1; transition: transform .2s; }
.sx .lp-acc details[open] summary::after { transform: rotate(45deg); }
.sx .lp-acc details > p, .sx .lp-acc details > ol { margin: 0; padding: 0 4px 20px; color: var(--text); font-size: 15.5px; }
.sx .lp-acc details > ol { padding-left: 24px; }
.sx .lp-sub { margin: 0 0 12px; font-size: 22px; font-weight: 800; color: var(--ink); }
.sx .lp-more { display: inline-flex; align-items: center; gap: 6px; color: var(--brand-text); font-weight: 600; text-decoration: none; }

/* inner pages: a grey head band */
.sx-page-head { padding: clamp(48px, 7vw, 88px) 0 clamp(36px, 5vw, 56px); background: var(--paper); text-align: center; }
.sx-page-head .site-h1 { max-width: 860px; margin: 0 auto; font-size: clamp(36px, 5vw, 60px); line-height: 1.06; font-weight: 800; letter-spacing: -.04em; }
.sx-page-head p { margin: 16px auto 0; max-width: 680px; color: var(--text); font-size: 18.5px; }
.sx-page-body { padding: clamp(40px, 6vw, 72px) 0 clamp(56px, 8vw, 96px); }
.sx .site-prose { margin: 0 auto; max-width: 760px; color: var(--text); }
.sx .site-prose h2 { margin: 32px 0 8px; font-size: 22px; font-weight: 800; color: var(--ink); }
.sx .site-prose a { color: var(--brand-text); font-weight: 600; }

/* pricing */
.sx-switch { display: flex; width: max-content; margin: 0 auto 36px; padding: 4px; border-radius: 10px; background: var(--paper); border: 1px solid var(--line); }
.sx-switch button { height: 40px; padding: 0 18px; border: 0; border-radius: 8px; background: none; font: inherit; font-weight: 600; color: var(--text); cursor: pointer; }
.sx-switch button.on { background: #fff; color: var(--ink); box-shadow: 0 1px 3px #0000001f; }
.sx-switch em { font-style: normal; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: var(--teal-soft); color: var(--teal-d); font-size: 12px; }
.sx .site-plans { gap: 20px; }
.sx .site-plan { position: relative; gap: 12px; padding: 30px 26px; border-radius: 16px; border: 1px solid var(--line); background: #fff; }
.sx .site-plan.pop { border: 2px solid var(--brand); box-shadow: 0 30px 60px -36px #c98f0099; }
.sx-popular { position: absolute; top: -13px; left: 26px; padding: 4px 12px; border-radius: 999px; background: var(--ink); color: var(--brand); font-size: 12.5px; font-weight: 700; }
.sx .site-plan h3 { font-size: 20px; font-weight: 700; color: var(--ink); }
.sx .site-plan .price { font-size: 38px; font-weight: 800; color: var(--ink); letter-spacing: -.04em; }
.sx .site-plan .lp-btn { width: 100%; }
.sx .site-plan li svg { color: var(--teal); }
.sx-every { margin: 56px auto 0; max-width: 980px; padding: clamp(24px, 4vw, 40px); border-radius: 18px; background: var(--paper); }
.sx-every h2 { font-size: 24px; font-weight: 800; }
.sx-every ul { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; margin: 20px 0; padding: 0; list-style: none; }
.sx-every li { display: flex; gap: 8px; font-size: 15px; } .sx-every li svg { flex: none; margin-top: 4px; color: var(--teal); }
.sx-every p { margin: 0; color: var(--text); font-size: 14.5px; }

/* features: the three stages as tabs, the full list */
.sx-tabs { display: grid; gap: 36px; }
.sx-tab-row { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; }
.sx-tab-row button { height: 44px; padding: 0 20px; border: 0; border-radius: 999px; background: var(--paper); font: inherit; font-weight: 600; color: var(--text); cursor: pointer; }
.sx-tab-row button.on { background: var(--brand); color: var(--brand-ink); }
.sx-tab-body { display: grid; grid-template-columns: 1fr 1.05fr; gap: clamp(28px, 6vw, 72px); align-items: center; }
.sx .lp-bento { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-flow: dense; gap: 16px; }
.sx .lp-feat { padding: 24px; border-radius: 16px; background: #fff; border: 1px solid var(--line); box-shadow: none; }
.sx .lp-feat.big { grid-column: span 2; background: var(--brand-soft); border-color: transparent; }
.sx .lp-feat h3 { margin: 14px 0 6px; font-size: 18px; font-weight: 700; } .sx .lp-feat p { margin: 0; color: var(--text); font-size: 15px; }
.sx .lp-aud { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.sx .lp-aud-card { padding: 26px; border-radius: 16px; background: var(--paper); border: 0; }
.sx .lp-aud-card h3 { font-size: 19px; font-weight: 800; margin-bottom: 12px; }
.sx .lp-aud-card ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 9px; }
.sx .lp-aud-card li { display: flex; gap: 8px; font-size: 14.5px; color: var(--text); } .sx .lp-aud-card li svg { flex: none; margin-top: 4px; color: var(--teal); }

/* status, notes */
.sx .site-status { margin: 0 auto; }
.sx .site-status div { border-radius: 12px; font-weight: 600; }
.sx .site-note { background: var(--mari-soft); border-color: #f6d58f; }

/* footer: dark, quiet */
.sx .lp-foot { background: #262833; color: #b9bcc6; padding: 64px 0 28px; border: 0; }
.sx .lp-foot-in { display: grid; grid-template-columns: 1.6fr repeat(3, 1fr); gap: 36px; }
.sx .lp-foot h4 { margin: 0 0 14px; color: #fff; font-size: 14px; font-weight: 700; letter-spacing: 0; text-transform: none; }
.sx .lp-foot a { display: block; margin-bottom: 9px; color: #b9bcc6; font-size: 14.5px; text-decoration: none; } .sx .lp-foot a:hover { color: #fff; }
.sx .lp-foot-brand .site-logo b { color: #fff; } .sx .lp-foot-brand p { margin: 14px 0 0; max-width: 340px; font-size: 14.5px; color: #9ea2ae; }
.sx .lp-foot-brand .hand { display: block; margin-top: 16px; color: var(--brand); }
.sx .lp-copy { margin-top: 44px; padding-top: 22px; border-top: 1px solid #ffffff17; color: #8a8f9c; font-size: 13.5px; }

@media (max-width: 960px) {
  .sx .lp-nav nav { display: none; } .sx-nav-cta { margin-left: auto; }
  .sx-row, .sx-tab-body { grid-template-columns: 1fr; } .sx-row.flip .sx-row-text { order: 0; }
  .sx-grid, .sx .lp-bento, .sx .lp-aud, .sx-every ul { grid-template-columns: 1fr 1fr; }
  .sx-integ, .sx-safe { grid-template-columns: 1fr 1fr; } .sx-steps { grid-template-columns: 1fr; }
  .sx .lp-foot-in { grid-template-columns: 1fr 1fr; } .sx .lp-foot-brand { grid-column: 1 / -1; }
  .sx-hero-note .sx-note { margin-left: 60px; }
}
@media (max-width: 600px) {
  .sx-grid, .sx .lp-bento, .sx .lp-aud, .sx-every ul, .sx-integ, .sx-safe { grid-template-columns: 1fr; } .sx .lp-feat.big { grid-column: auto; }
  .sx-apps { grid-template-columns: repeat(3, 1fr); gap: 22px 8px; } .sx-app span { width: 64px; height: 64px; border-radius: 16px; } .sx-app span svg { width: 30px; height: 30px; } .sx-app { font-size: 12.5px; }
  .sx-signin { display: none; } .sx .site-logo b { font-size: 19px; }
  .sx-hero-note .sx-note { margin-left: 0; } .sx .hl { white-space: normal; }
  .sx-hero-cta .lp-btn { width: 100%; }
}
`

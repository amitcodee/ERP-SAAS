// The platform's public site look (the apex domain only; the institute's own home page keeps LANDING_CSS as it is):
// white pages, one fresh green for every call to action, black outlined second buttons, a centred hero with floating
// cards, alternating feature rows on soft green panels. Loaded after LANDING_CSS by SiteShell and overrides it.
export const SITE_THEME = `
.lp.sx { --navy: #0b1220; --ink: #0b1220; --text: #4b5563; --muted: #6b7280; --line: #e5e7eb; --indigo: #0fae5c; --lime: #12c269;
  --green: #12c269; --green-d: #0a9a50; --green-soft: #eafaf1; --soft: #f7f9f8; font-family: var(--font-site), var(--font-sans), system-ui, sans-serif; }
.lp.sx h1, .lp.sx h2, .lp.sx h3 { letter-spacing: -.025em; text-wrap: balance; }

/* buttons */
.sx .lp-btn { height: 44px; padding: 0 18px; border-radius: 6px; font-weight: 600; font-size: 15px; box-shadow: none; }
.sx .lp-btn:hover { transform: translateY(-1px); }
.sx .lp-btn-lime, .sx .lp-btn-dark, .sx-btn-green { background: var(--green); color: #fff; border: 1.5px solid var(--green); }
.sx .lp-btn-lime:hover, .sx .lp-btn-dark:hover, .sx-btn-green:hover { background: var(--green-d); border-color: var(--green-d); }
.sx .lp-btn-ghost, .sx-btn-line { background: #fff; color: var(--ink); border: 1.5px solid var(--ink); }
.sx .lp-btn-ghost:hover, .sx-btn-line:hover { background: var(--ink); color: #fff; }

/* the slim offer line and the top bar */
.sx-offer { background: var(--green); color: #fff; text-align: center; font-size: 14px; font-weight: 600; padding: 9px 16px; }
.sx-offer a { margin-left: 10px; padding: 3px 10px; border-radius: 5px; background: #fff; color: var(--ink); text-decoration: none; font-size: 13px; font-weight: 700; white-space: nowrap; }
.sx .lp-nav { background: #fff; }
.sx .lp-nav-in { height: 64px; }
.sx .lp-nav nav { gap: 28px; }
.sx .lp-nav nav a { color: #111827; font-weight: 500; font-size: 15px; }
.sx .lp-nav nav a:hover { color: var(--green-d); }
.sx-nav-cta { display: flex; gap: 10px; }
.sx .site-logo { color: var(--ink); }
.sx .site-logo .lp-ico { background: var(--green); }
.sx .lp-ico { background: var(--green-soft); color: var(--green-d); }
.sx .lp-ico-glass { background: #ffffff1a; color: #fff; }

/* hero */
.sx-hero { padding: clamp(40px, 6vw, 72px) 0 0; text-align: center; background: linear-gradient(180deg, #fff 0%, #fbfdfc 100%); }
.sx-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: #f6f0ff; border: 1px solid #e3d4ff; color: #6d3fc0; font-size: 14px; font-weight: 500; }
.sx-hero h1 { margin: 22px auto 16px; max-width: 1040px; font-size: clamp(36px, 5.6vw, 60px); line-height: 1.1; font-weight: 700; color: var(--ink); }
.sx-hero h1 .g { display: block; color: var(--green); }
.sx-hero p.lead { margin: 0 auto; max-width: 640px; color: var(--text); font-size: clamp(16px, 1.6vw, 19px); }
.sx-cta { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 28px; }
.sx-ticks { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 22px; margin: 18px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 14px; }
.sx-ticks li { display: inline-flex; align-items: center; gap: 6px; } .sx-ticks svg { color: var(--green); }

/* the hero's picture: a dashboard on a soft green disc, with cards floating round it */
.sx-stage { position: relative; overflow: hidden; max-width: 1040px; height: clamp(360px, 44vw, 470px); margin: 44px auto 0; }
.sx-disc { position: absolute; left: 50%; bottom: -40%; width: min(620px, 90%); aspect-ratio: 1; transform: translateX(-50%); border-radius: 50%; background: radial-gradient(circle at 50% 30%, #d6f7e4, #eafaf1 60%, transparent 72%); }
.sx-arc { position: absolute; left: 50%; top: 40px; width: min(760px, 92%); aspect-ratio: 2 / 1; transform: translateX(-50%); border: 2px dashed #b9e9cf; border-bottom: 0; border-radius: 760px 760px 0 0; }
.sx-board { position: absolute; left: 50%; bottom: 0; width: min(560px, 86%); transform: translateX(-50%); border-radius: 16px 16px 0 0; background: #fff; box-shadow: 0 -10px 60px -20px #0b122033, 0 0 0 1px #e5e7eb; text-align: left; overflow: hidden; }
.sx-board-bar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; border-bottom: 1px solid var(--line); }
.sx-board-bar i { width: 9px; height: 9px; border-radius: 50%; background: #e5e7eb; } .sx-board-bar span { margin-left: 8px; color: var(--muted); font-size: 12px; font-weight: 600; }
.sx-board-body { padding: 16px; display: grid; gap: 12px; }
.sx-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.sx-kpis div { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.sx-kpis small { display: block; color: var(--muted); font-size: 11px; font-weight: 600; } .sx-kpis b { font-size: 18px; color: var(--ink); }
.sx-kpis em { font-style: normal; color: var(--green-d); font-size: 11px; font-weight: 700; margin-left: 4px; }
.sx-bars { display: flex; align-items: flex-end; gap: 8px; height: 96px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.sx-bars i { flex: 1; border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, #5fdc9a, #c4f1d8); } .sx-bars i:last-child { background: linear-gradient(180deg, var(--green), #7fe3ad); }
.sx-float { position: absolute; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: #fff; box-shadow: 0 18px 40px -16px #0b122040, 0 0 0 1px #eef0f2; text-align: left; animation: sx-bob 6s ease-in-out infinite; }
.sx-float b { display: block; font-size: 14px; color: var(--ink); line-height: 1.2; } .sx-float small { color: var(--muted); font-size: 12px; }
.sx-float .i { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: var(--green-soft); color: var(--green-d); flex: none; }
.sx-float.stat { flex-direction: column; gap: 0; padding: 12px 16px; transform: rotate(-4deg); } .sx-float.stat b { font-size: 24px; } .sx-float.stat .i { margin-bottom: 4px; }
.sx-f1 { left: 2%; top: 24%; } .sx-f2 { right: 1%; top: 12%; animation-delay: -2s; } .sx-f3 { left: 8%; bottom: 14%; animation-delay: -4s; } .sx-f4 { right: 3%; bottom: 4%; animation-delay: -1s; }
.sx-chat { position: absolute; z-index: 2; right: 14%; top: 40%; max-width: 230px; padding: 10px 12px; border-radius: 12px 12px 12px 2px; background: #dcf8c6; box-shadow: 0 12px 30px -14px #0b122040; text-align: left; font-size: 13px; color: #111827; }
.sx-chat small { display: block; margin-top: 2px; color: #5b7b5b; font-size: 11px; text-align: right; }
.sx-pill-ok { position: absolute; z-index: 3; left: 50%; bottom: 18px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 10px; padding: 10px 20px 10px 10px; border-radius: 999px; background: #fff; box-shadow: 0 20px 40px -18px #0b122055; font-size: 18px; font-weight: 600; color: var(--ink); white-space: nowrap; }
.sx-pill-ok .i { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: var(--green); color: #fff; }
@keyframes sx-bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -8px; } }

/* "made for" strip */
.sx-for { padding: 56px 0 24px; text-align: center; }
.sx-for h2 { font-size: clamp(24px, 3vw, 34px); font-weight: 700; color: var(--ink); }
.sx-for p { margin: 8px 0 0; color: var(--muted); }
.sx-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 26px; }
.sx-chips span { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: #374151; font-weight: 600; font-size: 14.5px; }
.sx-chips svg { color: var(--green-d); }

/* section heads */
.sx-head { max-width: 760px; margin: 0 auto 44px; text-align: center; }
.sx-head h2 { font-size: clamp(28px, 3.8vw, 42px); line-height: 1.15; font-weight: 700; color: var(--ink); }
.sx-head h2 .g { color: var(--green); }
.sx-head p { margin: 12px 0 0; color: var(--text); font-size: 17px; }

/* alternating feature rows */
.sx-rows { display: grid; gap: clamp(48px, 7vw, 88px); }
.sx-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(28px, 5vw, 72px); align-items: center; }
.sx-row.flip .sx-row-text { order: 2; }
.sx-row-text h3 { font-size: clamp(24px, 2.8vw, 34px); line-height: 1.2; font-weight: 700; color: var(--ink); }
.sx-row-text > p { margin: 12px 0 0; color: var(--text); font-size: 16.5px; }
.sx-list { display: grid; gap: 16px; margin: 24px 0 26px; padding: 0; list-style: none; }
.sx-list li { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; }
.sx-list .i { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: var(--green-soft); color: var(--green-d); }
.sx-list b { display: block; font-size: 16.5px; font-weight: 600; color: var(--ink); } .sx-list small { color: var(--muted); font-size: 14px; }
.sx-panel { position: relative; min-height: 360px; display: grid; place-items: center; padding: 28px; border-radius: 28px; background: linear-gradient(160deg, #f2fcf6 0%, #c9f3dc 100%); overflow: hidden; }
.sx-card { width: min(380px, 100%); border-radius: 16px; background: #fff; box-shadow: 0 24px 50px -24px #0b122055; padding: 16px; display: grid; gap: 10px; text-align: left; font-size: 13.5px; }
.sx-card h4 { margin: 0; font-size: 14px; color: var(--ink); display: flex; align-items: center; justify-content: space-between; }
.sx-card h4 em { font-style: normal; padding: 2px 8px; border-radius: 999px; background: var(--green-soft); color: var(--green-d); font-size: 11px; }
.sx-line { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; background: #f7f9f8; }
.sx-line .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--green); flex: none; } .sx-line .dot.o { background: #f59e0b; } .sx-line .dot.r { background: #ef4444; }
.sx-line span { flex: 1; color: #374151; } .sx-line b { color: var(--ink); }
.sx-bubble { justify-self: end; max-width: 85%; padding: 9px 11px; border-radius: 12px 12px 2px 12px; background: #dcf8c6; color: #111827; }
.sx-bubble small { display: block; color: #5b7b5b; font-size: 11px; text-align: right; }
.sx-receipt { display: grid; gap: 4px; padding: 12px; border: 1px dashed #c7d2cc; border-radius: 12px; }
.sx-receipt .amt { font-size: 26px; font-weight: 700; color: var(--ink); }
.sx-cert { display: grid; justify-items: center; gap: 4px; padding: 18px 12px; border: 2px solid var(--green); border-radius: 12px; text-align: center; }
.sx-cert b { font-size: 18px; } .sx-cert i { font-family: 'Brush Script MT', cursive; font-size: 24px; color: var(--ink); }
.sx-panel .sx-tag { position: absolute; right: 18px; top: 18px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 12px; background: #fff; box-shadow: 0 12px 30px -14px #0b122044; font-weight: 600; font-size: 13px; color: var(--ink); }
.sx-panel .sx-tag svg { color: var(--green-d); }

/* feature grid */
.sx-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.sx-grid > div { padding: 24px; border: 1px solid var(--line); border-radius: 16px; background: #fff; transition: border-color .15s, box-shadow .15s; }
.sx-grid > div:hover { border-color: #b7e9cd; box-shadow: 0 20px 44px -28px #0a9a5066; }
.sx-grid h3 { margin-top: 14px; font-size: 17px; font-weight: 600; color: var(--ink); } .sx-grid p { margin: 6px 0 0; color: var(--text); font-size: 14.5px; }

/* safe by design (light) */
.sx-safe { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.sx-safe > div { padding: 24px; border-radius: 16px; background: #fff; border: 1px solid var(--line); }
.sx-safe h3 { margin-top: 14px; font-size: 16.5px; font-weight: 600; } .sx-safe p { margin: 6px 0 0; color: var(--text); font-size: 14px; }

/* start in minutes */
.sx-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; counter-reset: step; }
.sx-steps > div { position: relative; padding: 28px 24px; border-radius: 18px; background: #fff; border: 1px solid var(--line); }
.sx-steps .n { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; background: var(--green); color: #fff; font-weight: 700; }
.sx-steps h3 { margin-top: 16px; font-size: 19px; font-weight: 600; } .sx-steps p { margin: 6px 0 0; color: var(--text); font-size: 15px; }

/* FAQ and the closing band */
.sx .lp-acc summary { font-weight: 600; } .sx .lp-acc summary::after { background: var(--green-soft); color: var(--green-d); }
.sx-band { padding: clamp(40px, 6vw, 64px) clamp(20px, 5vw, 56px); border-radius: 28px; background: linear-gradient(120deg, #0fae5c, #12c269 60%, #3ad687); color: #fff; text-align: center; }
.sx-band h2 { font-size: clamp(26px, 3.6vw, 40px); font-weight: 700; color: #fff; } .sx-band p { margin: 10px auto 0; max-width: 620px; color: #eafff3; font-size: 17px; }
.sx-band .sx-cta .lp-btn-ghost { border-color: #fff; background: transparent; color: #fff; } .sx-band .sx-cta .lp-btn-ghost:hover { background: #fff; color: var(--green-d); }
.sx-band .sx-cta .sx-btn-white { background: #fff; color: var(--green-d); border: 1.5px solid #fff; }

/* the plain pages and the footer in the same look */
.sx .lp-eyebrow { color: var(--green-d); letter-spacing: .12em; }
.sx .site-plan.pop { border-color: var(--green); box-shadow: 0 30px 60px -32px #0a9a5066; }
.sx .lp-feat.big { background: linear-gradient(135deg, #f2fcf6, #fff 70%); }
.sx .lp-aud-card:hover { border-color: #b7e9cd; box-shadow: 0 30px 60px -32px #0a9a5055; }
.sx .lp-more { color: var(--green-d); }
.sx .lp-foot { background: #0b1220; border-top: 0; } .sx .lp-foot h4 { color: #fff; } .sx .lp-foot a, .sx .lp-foot-brand p { color: #9ca3af; } .sx .lp-foot a:hover { color: #fff; }
.sx .lp-foot .site-logo { color: #fff; } .sx .lp-copy { border-top-color: #1f2937; color: #6b7280; }

@media (max-width: 1000px) {
  .sx-row, .sx-row.flip { grid-template-columns: 1fr; } .sx-row.flip .sx-row-text { order: 0; }
  .sx-grid, .sx-safe { grid-template-columns: repeat(2, 1fr); }
  .sx-f1, .sx-f3 { left: 0; } .sx-f2, .sx-f4 { right: 0; } .sx-chat { display: none; }
}
@media (max-width: 760px) {
  .sx-nav-cta .sx-btn-line { display: none; }
  .sx-steps { grid-template-columns: 1fr; }
  .sx-float.stat, .sx-f3, .sx-f4 { display: none; } .sx-f1 { top: 6%; } .sx-f2 { top: 6%; }
  .sx-pill-ok { font-size: 15px; }
}
@media (max-width: 520px) { .sx-grid, .sx-safe { grid-template-columns: 1fr; } .sx-float { display: none; } .sx-offer a { display: inline-block; margin-top: 4px; } }
@media (prefers-reduced-motion: reduce) { .sx-float { animation: none; } }

/* the scrolling word band under the hero */
.sx-marquee { overflow: hidden; padding: 26px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: #fff; }
.sx-marquee-in { display: flex; width: max-content; animation: sx-slide 38s linear infinite; }
.sx-marquee span { white-space: nowrap; padding-right: 8px; font-size: clamp(30px, 4.6vw, 58px); font-weight: 700; letter-spacing: -.03em; color: #111827; }
.sx-marquee mark { padding: 0 .12em; border-radius: 6px; background: linear-gradient(transparent 55%, #b8f0d0 55%); color: inherit; }
@keyframes sx-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* small eyebrow pills */
.sx-eyebrow { display: inline-block; margin-bottom: 14px; padding: 5px 12px; border-radius: 999px; background: var(--green-soft); color: var(--green-d); font-size: 12.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }

/* the orbit: what sits around a student */
.sx-orbit-row { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(28px, 5vw, 72px); align-items: center; }
.sx-orbit { position: relative; width: min(440px, 100%); aspect-ratio: 1; margin: 0 auto; }
.sx-orbit-ring { position: absolute; inset: 8%; border-radius: 50%; border: 2px dashed #b9e9cf; }
.sx-orbit-ring.r2 { inset: 28%; border: 0; background: radial-gradient(circle, #d6f7e4 0%, #eafaf1 60%, transparent 72%); }
.sx-orbit-core { position: absolute; left: 50%; top: 50%; width: 96px; height: 96px; translate: -50% -50%; display: grid; place-items: center; border-radius: 28px; background: var(--green); color: #fff; box-shadow: 0 20px 40px -14px #0a9a5088; }
.sx-orbit-item { position: absolute; left: 50%; top: 50%; width: 78px; display: grid; justify-items: center; gap: 4px; translate: -50% -50%;
  transform: rotate(var(--a)) translateY(calc(-1 * min(184px, 42vw))) rotate(calc(-1 * var(--a))); }
.sx-orbit-item svg { width: 46px; height: 46px; padding: 12px; border-radius: 14px; background: #fff; color: var(--green-d); box-shadow: 0 12px 26px -12px #0b122040, 0 0 0 1px #eef0f2; }
.sx-orbit-item small { font-size: 12px; font-weight: 600; color: #374151; }

/* integrations */
.sx-integ { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.sx-integ > div { display: grid; align-content: start; gap: 6px; padding: 20px; border-radius: 16px; background: #fff; border: 1px solid var(--line); }
.sx-integ b { margin-top: 8px; font-size: 16px; font-weight: 600; color: var(--ink); } .sx-integ small { color: var(--muted); font-size: 13.5px; line-height: 1.45; }

/* stage tabs (Features) */
.sx-tabs { display: grid; gap: 28px; }
.sx-tab-row { display: inline-flex; justify-self: center; gap: 6px; padding: 6px; border-radius: 999px; background: #f1f5f3; }
.sx-tab-row button { height: 42px; padding: 0 20px; border: 0; border-radius: 999px; background: transparent; color: #374151; font: inherit; font-weight: 600; cursor: pointer; }
.sx-tab-row button.on { background: #fff; color: var(--ink); box-shadow: 0 6px 16px -8px #0b122040; }
.sx-tab-body { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(28px, 5vw, 64px); align-items: center; }

/* pricing */
.sx-switch { display: flex; width: max-content; margin: 0 auto 28px; gap: 4px; padding: 5px; border-radius: 999px; background: #f1f5f3; }
.sx-switch button { height: 40px; padding: 0 18px; border: 0; border-radius: 999px; background: transparent; font: inherit; font-weight: 600; color: #374151; cursor: pointer; }
.sx-switch button.on { background: #fff; color: var(--ink); box-shadow: 0 6px 16px -8px #0b122040; }
.sx-switch em { margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: var(--green-soft); color: var(--green-d); font-style: normal; font-size: 12px; }
.sx .site-plan { position: relative; border-radius: 18px; }
.sx .site-plan .lp-btn { width: 100%; margin: 6px 0 4px; }
.sx-popular { position: absolute; top: -12px; left: 50%; translate: -50% 0; padding: 4px 12px; border-radius: 999px; background: var(--green); color: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; }
.sx-every { margin-top: 48px; padding: clamp(24px, 4vw, 40px); border-radius: 22px; background: var(--soft); border: 1px solid var(--line); }
.sx-every h2 { font-size: 22px; font-weight: 700; }
.sx-every ul { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; margin: 18px 0 0; padding: 0; list-style: none; }
.sx-every li { display: flex; gap: 8px; align-items: flex-start; color: #374151; } .sx-every svg { flex: none; margin-top: 4px; color: var(--green); }
.sx-every p { margin: 18px 0 0; color: var(--muted); font-size: 14px; }

@media (max-width: 1000px) {
  .sx-orbit-row, .sx-tab-body { grid-template-columns: 1fr; }
  .sx-integ { grid-template-columns: repeat(2, 1fr); } .sx-every ul { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 520px) {
  .sx-integ, .sx-every ul { grid-template-columns: 1fr; }
  .sx-orbit-item { width: 64px; } .sx-orbit-item svg { width: 40px; height: 40px; padding: 10px; } .sx-orbit-core { width: 72px; height: 72px; border-radius: 22px; }
  .sx-tab-row { flex-wrap: wrap; justify-content: center; border-radius: 18px; }
}
@media (prefers-reduced-motion: reduce) { .sx-marquee-in { animation: none; } }
`

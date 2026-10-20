// UI check in real (headless) Chrome against a running build: every page in the menu loads without errors, every
// popup that a page's buttons open is drawn over the whole page (never clipped or covered), fits the screen and
// closes with Escape, and a menu click shows the loading skeleton.
//   BASE_URL=http://localhost:3100 UI_EMAIL=... UI_PASSWORD=... pnpm exec dotenv -e .env.local -- tsx scripts/ui-check.ts
// Read-only: buttons that act at once (save, issue, approve, deactivate…) are never clicked.
import { chromium, type Page } from 'playwright-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const EMAIL = process.env.UI_EMAIL ?? process.env.SEED_ADMIN_EMAIL!
const PASSWORD = process.env.UI_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD!
// words on buttons that change something straight away (or leave the page): never clicked here
const ACTS = /reset|deactivate|activate|accept|mark|turn down|send|save|power|issue|approve|clear|close|restore|assign|cancel|withdraw|^end|delete for good|sign out|export|print|refresh|logout|offer|done|reject|revoke|decline|unblock|block|pin|remove/i

let failed = 0
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++ }

/** Opens the popup behind a button and checks where it is drawn; closes it again. */
async function probePopup(page: Page, label: string, click: () => Promise<void>) {
  await click()
  const dialog = page.locator('[role=dialog]').last()
  if (!(await dialog.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false))) return null // a link or an in-place change
  const r = await dialog.evaluate((d) => {
    const b = d.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(40, b.height / 2))
    return {
      onPage: d.closest('.modal-backdrop, .pt-pop-bg')?.parentElement === document.body,
      fits: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1,
      onTop: !!hit && d.contains(hit),
    }
  })
  await page.keyboard.press('Escape')
  const closed = await page.locator('[role=dialog]').count().then(async (n) => { for (let i = 0; i < 3 && n; i++) { await page.waitForTimeout(150); n = await page.locator('[role=dialog]').count() } return n === 0 })
  for (let i = 0; i < 4 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape')
  check(r.onPage && r.fits && r.onTop && closed, `popup "${label.slice(0, 60)}"${r.onPage ? '' : ' NOT on the page'}${r.fits ? '' : ' DOES NOT FIT'}${r.onTop ? '' : ' COVERED'}${closed ? '' : ' Escape did not close it'}`)
  return true
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|cz-shortcut|hydrat/i.test(m.text())) errors.push(m.text()) })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(EMAIL)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  check(true, 'signed in as head office')

  await page.locator('a.nav-item').first().waitFor({ state: 'visible', timeout: 20000 })
  const links = await page.locator('a.nav-item').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href')!, label: a.textContent!.trim() })))
  check(links.length > 20, `menu lists ${links.length} pages`)

  // the skeleton shows at once on a menu click
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  const target = page.locator('a.nav-item[href="/registrations"]')
  await target.click()
  const sawSkeleton = await page.locator('.sk-page').first().waitFor({ state: 'attached', timeout: 1500 }).then(() => true, () => false)
  check(sawSkeleton, 'a menu click shows the loading skeleton at once')
  await page.waitForURL(`${BASE}/registrations`)
  await page.locator('.sk-page').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  check((await page.locator('.sk-page').count()) === 0, 'the skeleton goes once the page has loaded')

  for (const l of links) {
    errors.length = 0
    const t0 = Date.now()
    const res = await page.goto(BASE + l.href, { waitUntil: 'networkidle' })
    const ms = Date.now() - t0
    const ok = !!res && res.status() < 400 && !(await page.getByText(/Application error|Something went wrong|This page could not be found/).count())
    check(ok, `${l.label.padEnd(22)} loads (${ms} ms)`)
    if (!ok) continue
    // popups: the page's add button(s), then every safe button of the first table row
    const heads = page.locator('.page-heading button.button.primary, .heading-actions button.button.primary')
    for (let i = 0; i < (await heads.count()); i++) {
      const b = heads.nth(i)
      const label = (await b.textContent())?.trim() ?? ''
      if (ACTS.test(label) || !(await b.isEnabled())) continue
      await probePopup(page, `${l.label} → ${label}`, () => b.click())
    }
    const row = page.locator('tbody tr').first().locator('td').last()
    const btns = row.locator('button')
    for (let i = 0; i < (await btns.count().catch(() => 0)); i++) {
      const b = btns.nth(i)
      const label = (await b.getAttribute('title')) || (await b.getAttribute('aria-label')) || ((await b.textContent()) ?? '').trim()
      if (!label || ACTS.test(label) || !(await b.isEnabled()) || !(await b.isVisible())) continue
      await probePopup(page, `${l.label} → ${label}`, () => b.click())
    }
    check(errors.length === 0, `${l.label.padEnd(22)} no browser errors${errors.length ? ': ' + errors.slice(0, 2).join(' | ').slice(0, 200) : ''}`)
  }

  await browser.close()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })

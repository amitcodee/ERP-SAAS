// One command for the full browser test:  pnpm test:e2e:full
// Needs the private dev database running (pnpm dev:db in another terminal). Builds the PRODUCTION bundle,
// starts it on :3300, runs scripts/e2e.ts against it in real Chrome, then stops the server.
import { spawn, spawnSync } from 'node:child_process'

const PORT = 3300
// No real e-mail from test runs: blank values win over .env.local, so the app behaves as if no mail server is set
// (and branches may work without their own mail server).
const env = { ...process.env, NEXT_DIST_DIR: '.next-build', BASE_URL: `http://localhost:${PORT}`, EMAIL_USER: '', EMAIL_PASS: '', SENDGRID_API_KEY: '', BRANCH_EMAIL_OPTIONAL: '1' }
const sh = (cmd, opts = {}) => spawnSync(cmd, { shell: true, stdio: 'inherit', env, ...opts })

console.log('[e2e] building production bundle…')
if (sh('pnpm exec next build').status !== 0) process.exit(1)
sh('git checkout tsconfig.json', { stdio: 'ignore' }) // next build touches it

console.log('[e2e] starting server…')
const win = process.platform === 'win32'
// POSIX (CI): own process group, so stopping it also stops `next start` under the shell.
const server = spawn(`pnpm exec next start -p ${PORT}`, { shell: true, stdio: 'ignore', env, detached: !win })
const stop = () => {
  if (win) { try { spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true, stdio: 'ignore' }) } catch {} }
  else { try { process.kill(-server.pid, 'SIGTERM') } catch {} }
  try { server.kill() } catch {}
}
process.on('exit', stop)

let up = false
for (let i = 0; i < 40 && !up; i++) {
  up = await fetch(`http://localhost:${PORT}/api/health`).then((r) => r.ok, () => false)
  if (!up) await new Promise((r) => setTimeout(r, 1500))
}
if (!up) { console.error('[e2e] server did not start (is the dev database running? is port 3300 free?)'); stop(); process.exit(1) }

const code = sh('pnpm exec dotenv -e .env.local -- tsx scripts/e2e.ts').status ?? 1
stop()
process.exit(code)

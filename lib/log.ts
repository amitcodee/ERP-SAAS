// Structured logs: one JSON object per line on stdout/stderr, so Coolify's log view (or any collector) can filter by field.
type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  )
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
}

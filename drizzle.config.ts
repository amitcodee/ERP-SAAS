import { defineConfig } from 'drizzle-kit'

// For reading only (studio, pull). Migrations are hand-written SQL (RLS policies, functions, triggers that the
// TypeScript schema does not describe): never run drizzle-kit generate / push here (pnpm db:generate refuses).
// lib/db/schema mirrors the database; pnpm test:schema checks every table, column, key and index against it.

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
})

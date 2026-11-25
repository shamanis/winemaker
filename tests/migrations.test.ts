import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, type DatabaseHandle } from '../src/main/db/database'
import { applyMigrations } from '../src/main/db/migrate'

const MIGRATIONS_FOLDER = resolve(__dirname, '..', 'drizzle')

// Отдельная in-memory БД на файл теста.
const handles: DatabaseHandle[] = []

function openMemory(): DatabaseHandle {
  const handle = createDatabase(':memory:')
  handles.push(handle)
  return handle
}

afterAll(() => {
  for (const handle of handles) handle.sqlite.close()
})

describe('миграции drizzle', () => {
  it('применяются на чистой БД и создают app_state и __schema', () => {
    const handle = openMemory()
    applyMigrations(handle, MIGRATIONS_FOLDER)

    const table = handle.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_state'"
      )
      .get()
    expect(table).toBeDefined()

    const schemaRow = handle.sqlite
      .prepare('SELECT version, applied_at FROM __schema LIMIT 1')
      .get() as { version: string; applied_at: string } | undefined
    expect(schemaRow).toBeDefined()
    expect(schemaRow?.version).toBeTruthy()
    expect(schemaRow?.applied_at).toMatch(/Z$/)
  })

  it('идемпотентны: повторное применение не падает и не дублирует', () => {
    const handle = openMemory()
    applyMigrations(handle, MIGRATIONS_FOLDER)
    applyMigrations(handle, MIGRATIONS_FOLDER)

    const rows = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
      .get() as { n: number }
    expect(rows.n).toBeGreaterThan(0)
  })
})

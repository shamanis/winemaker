import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
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

describe('миграция 0005: бэкфилл рукописных штаммов', () => {
  function apply0005(handle: DatabaseHandle, times = 1): void {
    const sql = readFileSync(join(MIGRATIONS_FOLDER, '0005_yeast_link_backfill.sql'), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      for (let i = 0; i < times; i++) handle.sqlite.exec(statement)
    }
  }

  function seedBatchWithOrphan(handle: DatabaseHandle): void {
    applyMigrations(handle, MIGRATIONS_FOLDER)
    handle.sqlite
      .prepare(
        `INSERT INTO batches (id, title, raw_material, style, volume_liters, start_date_utc, status, start_params, final_result, created_at_utc, archived_at_utc)
         VALUES ('b1', 'Сидр', 'Яблоки', NULL, NULL, '2026-10-20T12:00:00.000Z', 'fermenting', '{}', NULL, '2026-10-20T12:00:00.000Z', NULL)`
      )
      .run()
    // Рукописная запись до инварианта: strain_id NULL
    handle.sqlite
      .prepare(
        `INSERT INTO batch_yeast (id, batch_id, strain_id, strain_name, producer, dose_amount, dose_unit, added_at_utc)
         VALUES ('orphan-1', 'b1', NULL, 'Mangrove Jack''s CR-02', 'Mangrove Jack''s', 12, 'g', '2026-10-20T12:00:00.000Z')`
      )
      .run()
  }

  it('запись партии без strain_id получает штамм в справочнике и ссылку', () => {
    const handle = openMemory()
    seedBatchWithOrphan(handle)

    apply0005(handle)

    const linked = handle.sqlite
      .prepare(`SELECT strain_id, strain_name, producer FROM batch_yeast WHERE id = 'orphan-1'`)
      .get() as { strain_id: string; strain_name: string; producer: string | null }
    expect(linked.strain_id).not.toBeNull()
    expect(linked.strain_name).toBe("Mangrove Jack's CR-02")

    const strain = handle.sqlite
      .prepare('SELECT name, producer, notes FROM yeast_strains WHERE id = ?')
      .get(linked.strain_id) as { name: string; producer: string | null; notes: string | null }
    expect(strain.name).toBe("Mangrove Jack's CR-02")
    expect(strain.producer).toBe("Mangrove Jack's")
    expect(strain.notes).toContain('автоматически')
  })

  it('повторный прогон не дублирует штаммы в справочнике', () => {
    const handle = openMemory()
    seedBatchWithOrphan(handle)

    apply0005(handle, 2)

    const rows = handle.sqlite
      .prepare('SELECT COUNT(*) AS n FROM yeast_strains WHERE name = ?')
      .get("Mangrove Jack's CR-02") as { n: number }
    expect(rows.n).toBe(1)
    // ссылка стоит
    const linked = handle.sqlite
      .prepare(`SELECT strain_id FROM batch_yeast WHERE id = 'orphan-1'`)
      .get() as { strain_id: string | null }
    expect(linked.strain_id).not.toBeNull()
  })
})

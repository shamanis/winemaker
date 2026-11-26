import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DatabaseHandle } from './database'
import { nowUtcIso } from '../../shared/time/utc'

/**
 * Применяет миграции drizzle транзакционно и фиксирует версию схемы
 * в собственной таблице __schema (design.md D5). Идемпотентно:
 * повторный запуск не применяет уже применённые миграции.
 */
export function applyMigrations(
  handle: DatabaseHandle,
  migrationsFolder: string
): void {
  const { sqlite, db } = handle

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __schema (
      version TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  migrate(db, { migrationsFolder })

  const latest = sqlite
    .prepare(
      'SELECT hash FROM __drizzle_migrations ORDER BY id DESC LIMIT 1'
    )
    .get() as { hash: string } | undefined

  sqlite.prepare('DELETE FROM __schema').run()
  if (latest) {
    sqlite
      .prepare('INSERT INTO __schema (version, applied_at) VALUES (?, ?)')
      .run(latest.hash, nowUtcIso())
  }
}

import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema>

export interface DatabaseHandle {
  sqlite: Database.Database
  db: AppDatabase
}

/**
 * Открывает БД с прагмами надёжности (design.md D4–D5):
 * WAL — переживает аварийное завершение; synchronous=NORMAL — допустимо
 * в связке с WAL; foreign_keys — целостность связей.
 */
export function createDatabase(dbPath: string): DatabaseHandle {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { sqlite, db }
}

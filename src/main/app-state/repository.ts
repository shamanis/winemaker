import { eq } from 'drizzle-orm'
import { appState, type AppStateRow } from '../db/schema'
import type { AppDatabase } from '../db/database'
import { nowUtcIso } from '../../shared/time/utc'

/**
 * Репозиторий состояния приложения поверх app_state (design.md D8).
 * Все записи помечают БД «грязной» для планировщика бэкапов.
 */
export class AppStateRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly markDirty: () => void
  ) {}

  get<T>(key: string): T | null {
    const row: AppStateRow | undefined = this.db
      .select()
      .from(appState)
      .where(eq(appState.key, key))
      .get()
    return row ? (row.value as T) : null
  }

  set<T>(key: string, value: T): void {
    this.db
      .insert(appState)
      .values({ key, value, updatedAt: nowUtcIso() })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value, updatedAt: nowUtcIso() }
      })
      .run()
    this.markDirty()
  }
}

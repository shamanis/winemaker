import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Ключевое-значение для состояния приложения и представления:
 * тема, размеры окна, сортировки экранов и т. п. (design.md D8).
 */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull()
})

export type AppStateRow = typeof appState.$inferSelect
export type NewAppStateRow = typeof appState.$inferInsert

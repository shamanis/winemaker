import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

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

/**
 * Справочник приборов пользователя (спека reference-catalogs):
 * рефрактометры — с ATC и WCF, ареометры — с калибровочным смещением.
 */
export const instruments = sqliteTable('instruments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 'refractometer-atc' | 'refractometer' | 'hydrometer' | 'other' */
  type: text('type').notNull(),
  wcf: real('wcf'),
  calibrationOffsetSg: real('calibration_offset_sg'),
  /** Калибровочная температура прибора T_кал, °C (vision; по умолчанию 20). */
  calibrationTempC: real('calibration_temp_c'),
  /** Калибровочная пара «рефрактометр — ареометр» + вычисленный WCF. */
  calibrationPair: text('calibration_pair', { mode: 'json' }),
  createdAtUtc: text('created_at_utc').notNull(),
  updatedAtUtc: text('updated_at_utc').notNull()
})

export type InstrumentRow = typeof instruments.$inferSelect
export type NewInstrumentRow = typeof instruments.$inferInsert

/**
 * Пользовательский справочник штаммов дрожжей (без встроенной базы
 * производителя).
 */
export const yeastStrains = sqliteTable('yeast_strains', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  producer: text('producer'),
  tempMinC: real('temp_min_c'),
  tempMaxC: real('temp_max_c'),
  alcoholTolerancePct: real('alcohol_tolerance_pct'),
  notes: text('notes'),
  createdAtUtc: text('created_at_utc').notNull(),
  updatedAtUtc: text('updated_at_utc').notNull()
})

export type YeastStrainRow = typeof yeastStrains.$inferSelect
export type NewYeastStrainRow = typeof yeastStrains.$inferInsert

/**
 * Партия: карточка, жизненный цикл статусов, стартовые параметры
 * (сырое показание рядом с вычисленным OG в SG — req 1.5) и итоговые
 * характеристики архивации. JSON-столбцы валидируются zod-схемами
 * на границе IPC (design D1).
 */
export const batches = sqliteTable('batches', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  rawMaterial: text('raw_material').notNull(),
  style: text('style'),
  volumeLiters: real('volume_liters'),
  startDateUtc: text('start_date_utc').notNull(),
  /** 'fermenting' | 'slow-fermenting' | 'aging' | 'bottling' | 'archived' */
  status: text('status').notNull(),
  startParams: text('start_params', { mode: 'json' }).notNull(),
  finalResult: text('final_result', { mode: 'json' }),
  createdAtUtc: text('created_at_utc').notNull(),
  archivedAtUtc: text('archived_at_utc')
})

export type BatchRow = typeof batches.$inferSelect
export type NewBatchRow = typeof batches.$inferInsert

/** Дрожжи, внесённые в партию. Удаление штамма из справочника не теряет запись. */
export const batchYeast = sqliteTable('batch_yeast', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  strainId: text('strain_id').references(() => yeastStrains.id, {
    onDelete: 'set null'
  }),
  strainName: text('strain_name').notNull(),
  producer: text('producer'),
  doseAmount: real('dose_amount'),
  doseUnit: text('dose_unit').notNull(),
  addedAtUtc: text('added_at_utc').notNull(),
  productionDateUtc: text('production_date_utc')
})

export type BatchYeastRow = typeof batchYeast.$inferSelect
export type NewBatchYeastRow = typeof batchYeast.$inferInsert

/** Стартовые добавки партии: подкормки, ферменты, SO2 и т. п. */
export const batchAdditions = sqliteTable('batch_additions', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** 'nutrient' | 'enzyme' | 'so2' | 'sugar' | 'acid' | 'other' */
  kind: text('kind').notNull(),
  doseAmount: real('dose_amount'),
  doseUnit: text('dose_unit').notNull(),
  addedAtUtc: text('added_at_utc').notNull(),
  notes: text('notes')
})

export type BatchAdditionRow = typeof batchAdditions.$inferSelect
export type NewBatchAdditionRow = typeof batchAdditions.$inferInsert

/** Append-only история переходов статусов партии. */
export const batchStatusHistory = sqliteTable('batch_status_history', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  atUtc: text('at_utc').notNull()
})

export type BatchStatusHistoryRow = typeof batchStatusHistory.$inferSelect
export type NewBatchStatusHistoryRow = typeof batchStatusHistory.$inferInsert

/**
 * Замер партии: сырое значение + прибор + канонический скорректированный SG
 * и полный след пересчёта (спека measurement-correction).
 */
export const measurements = sqliteTable('measurements', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  /** 'density' | 'temperature' | 'ph' */
  kind: text('kind').notNull(),
  instrumentId: text('instrument_id').references(() => instruments.id, {
    onDelete: 'set null'
  }),
  rawValue: real('raw_value').notNull(),
  /** 'sg' | 'brix' — только для density. */
  unit: text('unit').notNull(),
  /** Температура сусла в момент замера, °C. */
  tempC: real('temp_c'),
  /** Каноническое значение для всех расчётов (спека 2.10). */
  correctedSg: real('corrected_sg'),
  correctedBrix: real('corrected_brix'),
  /** Полный след пересчёта: шаги [{type, input, output, note}] + warnings. */
  corrections: text('corrections', { mode: 'json' }).notNull(),
  measuredAtUtc: text('measured_at_utc').notNull(),
  notes: text('notes'),
  createdAtUtc: text('created_at_utc').notNull(),
  updatedAtUtc: text('updated_at_utc').notNull()
})

export type MeasurementRow = typeof measurements.$inferSelect
export type NewMeasurementRow = typeof measurements.$inferInsert

/** Аудит правок замера: снапшот до правки/удаления (спека 6.1.6). */
export const measurementRevisions = sqliteTable('measurement_revisions', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  /** Идентификатор замера без FK — аудит переживает удаление замера. */
  measurementId: text('measurement_id').notNull(),
  /** 'update' | 'delete' */
  action: text('action').notNull(),
  snapshot: text('snapshot', { mode: 'json' }).notNull(),
  revisedAtUtc: text('revised_at_utc').notNull()
})

export type MeasurementRevisionRow = typeof measurementRevisions.$inferSelect
export type NewMeasurementRevisionRow = typeof measurementRevisions.$inferInsert

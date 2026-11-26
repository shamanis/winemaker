import type {
  BatchOperationRow,
  BatchRow,
  MeasurementRow,
  BatchYeastRow,
  BatchAdditionRow,
  MeasurementRevisionRow,
  BatchStatusHistoryRow
} from '../db/schema'

export interface ExportPayload {
  schemaVersion: 1
  exportedAtUtc: string
  appVersion: string
  batch: BatchRow
  measurements: MeasurementRow[]
  measurementRevisions: MeasurementRevisionRow[]
  operations: BatchOperationRow[]
  yeast: BatchYeastRow[]
  additions: BatchAdditionRow[]
  statusHistory: BatchStatusHistoryRow[]
}

export interface ExportSource {
  batch: BatchRow
  measurements: MeasurementRow[]
  measurementRevisions: MeasurementRevisionRow[]
  operations: BatchOperationRow[]
  yeast: BatchYeastRow[]
  additions: BatchAdditionRow[]
  statusHistory: BatchStatusHistoryRow[]
}

/**
 * Полный переносимый пакет партии (спека data-portability):
 * читается без приложения; schemaVersion — контракт для будущих версий.
 * Чистая сборка — покрыта юнит-тестом; запись файла — в канале IPC.
 */
export function buildExportPayload(source: ExportSource, appVersion: string): ExportPayload {
  return {
    schemaVersion: 1,
    exportedAtUtc: new Date().toISOString(),
    appVersion,
    batch: source.batch,
    measurements: source.measurements,
    measurementRevisions: source.measurementRevisions,
    operations: source.operations,
    yeast: source.yeast,
    additions: source.additions,
    statusHistory: source.statusHistory
  }
}

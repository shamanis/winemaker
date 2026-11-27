import { asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  measurements,
  measurementRevisions,
  type MeasurementRevisionRow,
  type MeasurementRow,
  type NewMeasurementRow,
  type NewMeasurementRevisionRow
} from '../db/schema'
import type { AppDatabase } from '../db/database'
import { nowUtcIso } from '../../shared/time/utc'
import type { MarkDirty } from '../catalogs/repositories'
import { resolveMeasurement, type PipelineContext, type ResolvedMeasurement } from '../../shared/calculations/pipeline'
import type { CorrectionsDto } from '../../shared/ipc/contracts'
import type { TranslateFn } from '../../shared/i18n/create-i18n'

export interface MeasurementCreateInput {
  batchId: string
  kind: 'density' | 'temperature' | 'ph'
  instrumentId?: string | null
  rawValue: number
  unit: 'sg' | 'brix'
  tempC?: number | null
  measuredAtUtc: string
  notes?: string | null
}

/** Провайдер контекста коррекции: прибор, формула из настроек, старт партии. */
export type ResolveContextProvider = (
  batchId: string,
  instrumentId: string | null
) => PipelineContext

/** t() с текущим языком main — читается в момент записи замера (design D6). */
export type TraceTextProvider = () => TranslateFn

/**
 * Репозиторий замеров (design D1/D3): коррекция выполняется при каждом
 * сохранении — correctedSg всегда каноничен; правки пишут ревизии.
 */
export class MeasurementRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly markDirty: MarkDirty,
    private readonly resolveCtx: ResolveContextProvider,
    private readonly traceT: TraceTextProvider
  ) {}

  private resolveFor(input: {
    batchId: string
    instrumentId?: string | null
    kind: 'density' | 'temperature' | 'ph'
    rawValue: number
    unit: 'sg' | 'brix'
    tempC?: number | null
    measuredAtUtc: string
  }): ResolvedMeasurement {
    const ctx = this.resolveCtx(input.batchId, input.instrumentId ?? null)
    return resolveMeasurement(
      {
        kind: input.kind,
        rawValue: input.rawValue,
        unit: input.unit,
        tempC: input.tempC ?? null,
        measuredAtUtc: input.measuredAtUtc
      },
      ctx
    )
  }

  create(input: MeasurementCreateInput): MeasurementRow {
    const resolved = this.resolveFor(input)
    const now = nowUtcIso()
    const row: NewMeasurementRow = {
      id: randomUUID(),
      batchId: input.batchId,
      kind: input.kind,
      instrumentId: input.instrumentId ?? null,
      rawValue: input.rawValue,
      unit: input.unit,
      tempC: input.tempC ?? null,
      correctedSg: resolved.correctedSg,
      correctedBrix: resolved.correctedBrix,
      corrections: this.toStoredCorrections(resolved),
      measuredAtUtc: input.measuredAtUtc,
      notes: input.notes ?? null,
      createdAtUtc: now,
      updatedAtUtc: now
    }
    this.db.insert(measurements).values(row).run()
    this.markDirty()
    return row as MeasurementRow
  }

  /**
   * След к форме хранения (design D6): готовый текст на языке, действовавшем
   * при сохранении (читается без приложения — data-portability), рядом —
   * машинные коды для показа на текущем языке интерфейса.
   */
  private toStoredCorrections(resolved: {
    corrections: Array<{ type: string; input: number; output: number; code?: string; params?: Record<string, string | number> }>
    warnings: Array<{ code: string; params?: Record<string, string | number> }>
    infos: Array<{ code: string; params?: Record<string, string | number> }>
  }): CorrectionsDto {
    const t = this.traceT()
    return {
      steps: resolved.corrections.map((step) => ({
        type: step.type,
        input: step.input,
        output: step.output,
        note: step.code ? t(step.code, { ...step.params }) : undefined,
        code: step.code,
        params: step.params
      })),
      warnings: resolved.warnings.map((w) => t(w.code, { ...w.params })),
      infos: resolved.infos.map((i) => t(i.code, { ...i.params })),
      warningCodes: resolved.warnings,
      infoCodes: resolved.infos
    }
  }

  listByBatch(batchId: string): MeasurementRow[] {
    return this.db
      .select()
      .from(measurements)
      .where(eq(measurements.batchId, batchId))
      .orderBy(asc(measurements.measuredAtUtc))
      .all()
  }

  get(id: string): MeasurementRow | undefined {
    return this.db.select().from(measurements).where(eq(measurements.id, id)).get()
  }

  /** Удаление: снапшот с action=delete, затем удаление. */
  delete(id: string): void {
    const current = this.get(id)
    if (!current) return
    this.insertRevision(current.batchId, id, 'delete', current)
    this.db.delete(measurements).where(eq(measurements.id, id)).run()
    this.markDirty()
  }

  listRevisions(id: string): MeasurementRevisionRow[] {
    return this.db
      .select()
      .from(measurementRevisions)
      .where(eq(measurementRevisions.measurementId, id))
      .orderBy(asc(measurementRevisions.revisedAtUtc))
      .all()
  }

  /** Все ревизии замеров партии — для экспорта (design D5). */
  listRevisionsByBatch(batchId: string): MeasurementRevisionRow[] {
    return this.db
      .select()
      .from(measurementRevisions)
      .where(eq(measurementRevisions.batchId, batchId))
      .orderBy(asc(measurementRevisions.revisedAtUtc))
      .all()
  }

  private insertRevision(
    batchId: string,
    measurementId: string,
    action: 'update' | 'delete',
    snapshot: MeasurementRow
  ): void {
    const row: NewMeasurementRevisionRow = {
      id: randomUUID(),
      batchId,
      measurementId,
      action,
      snapshot,
      revisedAtUtc: nowUtcIso()
    }
    this.db.insert(measurementRevisions).values(row).run()
    this.markDirty()
  }
}

import { desc, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  batches,
  batchAdditions,
  batchStatusHistory,
  batchYeast,
  instruments,
  type BatchAdditionRow,
  type BatchRow,
  type BatchStatusHistoryRow,
  type BatchYeastRow,
  type NewBatchAdditionRow,
  type NewBatchYeastRow
} from '../db/schema'
import type { AppDatabase } from '../db/database'
import { nowUtcIso } from '../../shared/time/utc'
import type { MarkDirty } from '../catalogs/repositories'
import { resolveOgSg, type RawGravityInput } from '../../shared/calculations/density'

export const BATCH_STATUSES = [
  'fermenting',
  'slow-fermenting',
  'aging',
  'bottling',
  'archived'
] as const

export type BatchStatus = (typeof BATCH_STATUSES)[number]

export interface BatchYeastInput {
  strainId?: string | null
  strainName: string
  producer?: string | null
  doseAmount: number
  doseUnit: string
  addedAtUtc: string
  productionDateUtc?: string | null
}

export interface BatchAdditionInput {
  name: string
  kind: string
  doseAmount: number
  doseUnit: string
  addedAtUtc: string
  notes?: string | null
}

export interface StartGravityRaw extends RawGravityInput {
  instrumentId?: string | null
}

export interface StartParams {
  gravity: {
    raw: StartGravityRaw
    /** OG в SG — вычисляется при сохранении (design D7, req 1.5). */
    ogSg: number
    correctedBrix?: number | null
  }
  ph?: number | null
  tempC?: number | null
}

export interface FinalResult {
  finalGravity?: number | null
  abvPct?: number | null
  tastingNotes?: string | null
}

export interface CreateBatchInput {
  title: string
  rawMaterial: string
  style?: string | null
  volumeLiters?: number | null
  startDateUtc: string
  startParams: {
    gravity: { raw: StartGravityRaw }
    ph?: number | null
    tempC?: number | null
  }
  yeast: BatchYeastInput[]
  additions: BatchAdditionInput[]
}

export interface BatchFull {
  batch: BatchRow
  yeast: BatchYeastRow[]
  additions: BatchAdditionRow[]
  history: BatchStatusHistoryRow[]
}

/** Репозиторий партий: транзакции, append-only история статусов (design D3). */
export class BatchRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly markDirty: MarkDirty
  ) {}

  /**
   * Создаёт партию одной транзакцией: карточка + вычисленный OG в SG +
   * дрожжи + добавки + запись истории «постановка» (fermenting).
   */
  create(input: CreateBatchInput): BatchFull {
    const created = this.db.transaction((): BatchRow => {
      const instrument = input.startParams.gravity.raw.instrumentId
        ? this.db
            .select()
            .from(instruments)
            .where(eq(instruments.id, input.startParams.gravity.raw.instrumentId))
            .get()
        : undefined

      const resolved = resolveOgSg(input.startParams.gravity.raw, instrument ?? null)
      const startParams: StartParams = {
        gravity: {
          raw: input.startParams.gravity.raw,
          ogSg: resolved.ogSg,
          correctedBrix: resolved.correctedBrix
        },
        ph: input.startParams.ph ?? null,
        tempC: input.startParams.tempC ?? null
      }

      const batch: BatchRow = {
        id: randomUUID(),
        title: input.title,
        rawMaterial: input.rawMaterial,
        style: input.style ?? null,
        volumeLiters: input.volumeLiters ?? null,
        startDateUtc: input.startDateUtc,
        status: 'fermenting',
        startParams,
        finalResult: null,
        createdAtUtc: nowUtcIso(),
        archivedAtUtc: null
      }
      this.db.insert(batches).values(batch).run()

      this.insertStatusHistory(batch.id, null, 'fermenting', input.startDateUtc)

      for (const yeast of input.yeast) {
        const row: NewBatchYeastRow = {
          id: randomUUID(),
          batchId: batch.id,
          strainId: yeast.strainId ?? null,
          strainName: yeast.strainName,
          producer: yeast.producer ?? null,
          doseAmount: yeast.doseAmount,
          doseUnit: yeast.doseUnit,
          addedAtUtc: yeast.addedAtUtc,
          productionDateUtc: yeast.productionDateUtc ?? null
        }
        this.db.insert(batchYeast).values(row).run()
      }

      for (const addition of input.additions) {
        const row: NewBatchAdditionRow = {
          id: randomUUID(),
          batchId: batch.id,
          name: addition.name,
          kind: addition.kind,
          doseAmount: addition.doseAmount,
          doseUnit: addition.doseUnit,
          addedAtUtc: addition.addedAtUtc,
          notes: addition.notes ?? null
        }
        this.db.insert(batchAdditions).values(row).run()
      }

      return batch
    })

    this.markDirty()
    return this.get(created.id) as BatchFull
  }

  listActive(): BatchRow[] {
    return this.db
      .select()
      .from(batches)
      .where(inArray(batches.status, ['fermenting', 'slow-fermenting', 'aging', 'bottling']))
      .orderBy(desc(batches.startDateUtc))
      .all()
  }

  listArchived(): BatchRow[] {
    return this.db
      .select()
      .from(batches)
      .where(eq(batches.status, 'archived'))
      .orderBy(desc(batches.archivedAtUtc))
      .all()
  }

  get(id: string): BatchFull | undefined {
    const batch = this.db.select().from(batches).where(eq(batches.id, id)).get()
    if (!batch) return undefined
    return {
      batch,
      yeast: this.db.select().from(batchYeast).where(eq(batchYeast.batchId, id)).all(),
      additions: this.db
        .select()
        .from(batchAdditions)
        .where(eq(batchAdditions.batchId, id))
        .all(),
      history: this.db
        .select()
        .from(batchStatusHistory)
        .where(eq(batchStatusHistory.batchId, id))
        .orderBy(batchStatusHistory.atUtc)
        .all()
    }
  }

  /** Смена статуса: полный граф разрешён, переход пишется в историю. */
  changeStatus(id: string, to: BatchStatus, atUtc?: string): BatchFull | undefined {
    const batch = this.db.select().from(batches).where(eq(batches.id, id)).get()
    if (!batch) return undefined
    this.db.transaction((tx) => {
      tx.update(batches).set({ status: to }).where(eq(batches.id, id)).run()
      this.insertStatusHistory(id, batch.status as BatchStatus, to, atUtc ?? nowUtcIso())
    })
    this.markDirty()
    return this.get(id)
  }

  /**
   * Архивация: требует итоговые характеристики (спека batch-management),
   * пишет archivedAtUtc. Идемпотентность не требуется — повторная архивация
   * архивной партии отклоняется.
   */
  archive(id: string, finalResult: FinalResult): BatchFull | undefined {
    const batch = this.db.select().from(batches).where(eq(batches.id, id)).get()
    if (!batch) return undefined
    if (batch.status === 'archived') {
      throw new Error('Batch is already archived')
    }
    const at = nowUtcIso()
    this.db.transaction((tx) => {
      tx.update(batches)
        .set({ status: 'archived', finalResult, archivedAtUtc: at })
        .where(eq(batches.id, id))
        .run()
      this.insertStatusHistory(id, batch.status as BatchStatus, 'archived', at)
    })
    this.markDirty()
    return this.get(id)
  }

  update(
    id: string,
    patch: Partial<Pick<BatchRow, 'title' | 'rawMaterial' | 'style' | 'volumeLiters'>>
  ): BatchFull | undefined {
    const updated = this.db.update(batches).set(patch).where(eq(batches.id, id)).returning().get()
    if (updated) this.markDirty()
    return updated ? this.get(id) : undefined
  }

  /**
   * Заменяет состав дрожжей партии целиком (design fix: редактирование
   * после создания). Один вызов = одна транзакция.
   */
  setYeast(batchId: string, rows: BatchYeastInput[]): BatchFull | undefined {
    const batch = this.db.select().from(batches).where(eq(batches.id, batchId)).get()
    if (!batch) return undefined
    this.db.transaction((tx) => {
      tx.delete(batchYeast).where(eq(batchYeast.batchId, batchId)).run()
      for (const yeast of rows) {
        tx.insert(batchYeast).values({
          id: randomUUID(),
          batchId,
          strainId: yeast.strainId ?? null,
          strainName: yeast.strainName,
          producer: yeast.producer ?? null,
          doseAmount: yeast.doseAmount,
          doseUnit: yeast.doseUnit,
          addedAtUtc: yeast.addedAtUtc,
          productionDateUtc: yeast.productionDateUtc ?? null
        }).run()
      }
    })
    this.markDirty()
    return this.get(batchId)
  }

  /** Заменяет состав стартовых добавок партии целиком. */
  setAdditions(batchId: string, rows: BatchAdditionInput[]): BatchFull | undefined {
    const batch = this.db.select().from(batches).where(eq(batches.id, batchId)).get()
    if (!batch) return undefined
    this.db.transaction((tx) => {
      tx.delete(batchAdditions).where(eq(batchAdditions.batchId, batchId)).run()
      for (const addition of rows) {
        tx.insert(batchAdditions).values({
          id: randomUUID(),
          batchId,
          name: addition.name,
          kind: addition.kind,
          doseAmount: addition.doseAmount,
          doseUnit: addition.doseUnit,
          addedAtUtc: addition.addedAtUtc,
          notes: addition.notes ?? null
        }).run()
      }
    })
    this.markDirty()
    return this.get(batchId)
  }

  delete(id: string): void {
    this.db.delete(batches).where(eq(batches.id, id)).run()
    this.markDirty()
  }

  private insertStatusHistory(
    batchId: string,
    from: BatchStatus | null,
    to: BatchStatus,
    atUtc: string
  ): void {
    this.db.insert(batchStatusHistory).values({
      id: randomUUID(),
      batchId,
      fromStatus: from,
      toStatus: to,
      atUtc
    }).run()
  }
}

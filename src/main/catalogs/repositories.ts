import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { instruments, yeastStrains, type InstrumentRow, type NewInstrumentRow, type YeastStrainRow, type NewYeastStrainRow } from '../db/schema'
import type { AppDatabase } from '../db/database'
import { nowUtcIso } from '../../shared/time/utc'
import { computePersonalWcf } from '../../shared/calculations/correction'

/** markDirty планировщика бэкапов — на каждую мутацию. */
export type MarkDirty = () => void

export interface CalibrationPair {
  refrBrix: number
  hydrometerBx: number
  wcf: number
  atUtc: string
}

/** Репозиторий справочника приборов (design D3). */
export class InstrumentRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly markDirty: MarkDirty
  ) {}

  list(): InstrumentRow[] {
    return this.db.select().from(instruments).all()
  }

  get(id: string): InstrumentRow | undefined {
    return this.db.select().from(instruments).where(eq(instruments.id, id)).get()
  }

  create(data: Omit<NewInstrumentRow, 'id' | 'createdAtUtc' | 'updatedAtUtc'>): InstrumentRow {
    const now = nowUtcIso()
    const row: NewInstrumentRow = { id: randomUUID(), createdAtUtc: now, updatedAtUtc: now, ...data }
    this.db.insert(instruments).values(row).run()
    this.markDirty()
    return row as InstrumentRow
  }

  update(id: string, patch: Partial<Omit<NewInstrumentRow, 'id' | 'createdAtUtc'>>): InstrumentRow | undefined {
    const updated = this.db
      .update(instruments)
      .set({ ...patch, updatedAtUtc: nowUtcIso() })
      .where(eq(instruments.id, id))
      .returning()
      .get()
    if (updated) this.markDirty()
    return updated
  }

  delete(id: string): void {
    this.db.delete(instruments).where(eq(instruments.id, id)).run()
    this.markDirty()
  }

  /**
   * Одноразовая калибровка по паре «рефрактометр — ареометр» (спека 2.6):
   * вычисляет персональный WCF и фиксирует пару в карточке прибора.
   */
  calibrate(
    instrumentId: string,
    refrBrix: number,
    hydrometerBx: number
  ): { instrument: InstrumentRow; wcf: number } {
    const instrument = this.get(instrumentId)
    if (!instrument) throw new Error('Instrument not found')
    if (!instrument.type.startsWith('refractometer')) {
      throw new Error('Calibration pair applies to a refractometer')
    }
    const wcf = computePersonalWcf(refrBrix, hydrometerBx)
    const pair: CalibrationPair = {
      refrBrix,
      hydrometerBx,
      wcf,
      atUtc: nowUtcIso()
    }
    const updated = this.db
      .update(instruments)
      .set({ wcf, calibrationPair: pair, updatedAtUtc: nowUtcIso() })
      .where(eq(instruments.id, instrumentId))
      .returning()
      .get()
    if (updated) this.markDirty()
    return { instrument: updated as InstrumentRow, wcf }
  }
}

/** Репозиторий справочника штаммов дрожжей (design D3). */
export class YeastStrainRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly markDirty: MarkDirty
  ) {}

  list(): YeastStrainRow[] {
    return this.db.select().from(yeastStrains).all()
  }

  get(id: string): YeastStrainRow | undefined {
    return this.db.select().from(yeastStrains).where(eq(yeastStrains.id, id)).get()
  }

  create(data: Omit<NewYeastStrainRow, 'id' | 'createdAtUtc' | 'updatedAtUtc'>): YeastStrainRow {
    const now = nowUtcIso()
    const row: NewYeastStrainRow = { id: randomUUID(), createdAtUtc: now, updatedAtUtc: now, ...data }
    this.db.insert(yeastStrains).values(row).run()
    this.markDirty()
    return row as YeastStrainRow
  }

  update(id: string, patch: Partial<Omit<NewYeastStrainRow, 'id' | 'createdAtUtc'>>): YeastStrainRow | undefined {
    const updated = this.db
      .update(yeastStrains)
      .set({ ...patch, updatedAtUtc: nowUtcIso() })
      .where(eq(yeastStrains.id, id))
      .returning()
      .get()
    if (updated) this.markDirty()
    return updated
  }

  delete(id: string): void {
    this.db.delete(yeastStrains).where(eq(yeastStrains.id, id)).run()
    this.markDirty()
  }
}

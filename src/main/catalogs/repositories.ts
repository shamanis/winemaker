import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { instruments, yeastStrains, type InstrumentRow, type NewInstrumentRow, type YeastStrainRow, type NewYeastStrainRow } from '../db/schema'
import type { AppDatabase } from '../db/database'
import { nowUtcIso } from '../../shared/time/utc'

/** markDirty планировщика бэкапов — на каждую мутацию. */
export type MarkDirty = () => void

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

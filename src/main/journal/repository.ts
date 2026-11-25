import { asc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import {
  batchOperations,
  type BatchOperationRow,
  type NewBatchOperationRow
} from '../db/schema'
import type { AppDatabase } from '../db/database'
import { nowUtcIso } from '../../shared/time/utc'
import type { MarkDirty } from '../catalogs/repositories'

export interface OperationCreateInput {
  batchId: string
  kind: string
  atUtc: string
  notes?: string | null
}

/** Репозиторий технологических операций (design D4). */
export class OperationRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly markDirty: MarkDirty
  ) {}

  listByBatch(batchId: string): BatchOperationRow[] {
    return this.db
      .select()
      .from(batchOperations)
      .where(eq(batchOperations.batchId, batchId))
      .orderBy(asc(batchOperations.atUtc))
      .all()
  }

  get(id: string): BatchOperationRow | undefined {
    return this.db.select().from(batchOperations).where(eq(batchOperations.id, id)).get()
  }

  create(input: OperationCreateInput): BatchOperationRow {
    const row: NewBatchOperationRow = {
      id: randomUUID(),
      batchId: input.batchId,
      kind: input.kind,
      atUtc: input.atUtc,
      notes: input.notes ?? null,
      createdAtUtc: nowUtcIso(),
      updatedAtUtc: nowUtcIso()
    }
    this.db.insert(batchOperations).values(row).run()
    this.markDirty()
    return row as BatchOperationRow
  }

  update(id: string, patch: Partial<Omit<OperationCreateInput, 'batchId'>>): BatchOperationRow | undefined {
    const updated = this.db
      .update(batchOperations)
      .set({ ...patch, updatedAtUtc: nowUtcIso() })
      .where(eq(batchOperations.id, id))
      .returning()
      .get()
    if (updated) this.markDirty()
    return updated
  }

  delete(id: string): void {
    this.db.delete(batchOperations).where(eq(batchOperations.id, id)).run()
    this.markDirty()
  }
}

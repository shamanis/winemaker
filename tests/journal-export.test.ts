import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, type DatabaseHandle } from '../src/main/db/database'
import { applyMigrations } from '../src/main/db/migrate'
import { OperationRepository } from '../src/main/journal/repository'
import { buildExportPayload } from '../src/main/export/payload'
import { BatchRepository } from '../src/main/batches/repository'
import { MeasurementRepository } from '../src/main/measurements/repository'
import { InstrumentRepository } from '../src/main/catalogs/repositories'
import { createResolveContextProvider } from '../src/main/measurements/context'
import type { AppStateRepository } from '../src/main/app-state/repository'

const MIGRATIONS_FOLDER = resolve(__dirname, '..', 'drizzle')
const handles: DatabaseHandle[] = []

function openMemory(): DatabaseHandle {
  const handle = createDatabase(':memory:')
  applyMigrations(handle, MIGRATIONS_FOLDER)
  handles.push(handle)
  return handle
}

afterAll(() => {
  for (const handle of handles) handle.sqlite.close()
})

describe('OperationRepository', () => {
  it('CRUD операций: create/list/update/delete', () => {
    const handle = openMemory()
    let dirty = 0
    const repo = new OperationRepository(handle.db, () => dirty++)
    const batches = new BatchRepository(handle.db, () => undefined)
    const batch = batches.create({
      title: 'Партия для операций',
      rawMaterial: 'Виноград',
      startDateUtc: '2026-11-25T10:00:00.000Z',
      startParams: { gravity: { raw: { value: 22, unit: 'brix' as const, instrumentId: null } } },
      yeast: [],
      additions: []
    })
    const batchId = batch.batch.id
    expect(repo.listByBatch(batchId)).toHaveLength(0)

    const created = repo.create({
      batchId,
      kind: 'rack',
      atUtc: '2026-11-26T12:00:00.000Z',
      notes: 'первое снятие'
    })
    expect(repo.listByBatch(batchId)).toHaveLength(1)
    expect(created.notes).toBe('первое снятие')

    const updated = repo.update(created.id, { notes: 'снятие с осадка' })
    expect(updated?.notes).toBe('снятие с осадка')

    repo.delete(created.id)
    expect(repo.listByBatch(batchId)).toHaveLength(0)
    expect(dirty).toBe(3)
  })
})

describe('buildExportPayload (data-portability)', () => {
  it('полный пакет: schemaVersion, партия, замеры, ревизии, операции', () => {
    const handle = openMemory()
    const instruments = new InstrumentRepository(handle.db, () => undefined)
    const batches = new BatchRepository(handle.db, () => undefined)
    const appStateStub = { get: () => null } as unknown as AppStateRepository
    const measurements = new MeasurementRepository(
      handle.db,
      () => undefined,
      createResolveContextProvider({ appState: appStateStub, instruments, batches })
    )
    const operations = new OperationRepository(handle.db, () => undefined)

    const refr = instruments.create({ name: 'Рефрактометр', type: 'refractometer-atc', wcf: 1.04, calibrationOffsetSg: null })
    const batch = batches.create({
      title: 'Экспорт-тест',
      rawMaterial: 'Виноград',
      startDateUtc: '2026-11-25T10:00:00.000Z',
      startParams: { gravity: { raw: { value: 22, unit: 'brix', instrumentId: refr.id } } },
      yeast: [],
      additions: []
    })
    measurements.create({
      batchId: batch.batch.id, kind: 'density', instrumentId: refr.id,
      rawValue: 10, unit: 'brix', measuredAtUtc: '2026-11-26T12:00:00.000Z'
    })
    const m2 = measurements.create({
      batchId: batch.batch.id, kind: 'ph', instrumentId: null,
      rawValue: 3.4, unit: 'sg', measuredAtUtc: '2026-11-26T13:00:00.000Z'
    })
    measurements.update(m2.id, { rawValue: 3.5 })
    operations.create({ batchId: batch.batch.id, kind: 'rack', atUtc: '2026-11-27T10:00:00.000Z' })

    const full = batches.get(batch.batch.id)!
    const payload = buildExportPayload(
      {
        batch: full.batch,
        measurements: measurements.listByBatch(batch.batch.id),
        measurementRevisions: measurements.listRevisionsByBatch(batch.batch.id),
        operations: operations.listByBatch(batch.batch.id),
        yeast: full.yeast,
        additions: full.additions,
        statusHistory: full.history
      },
      '0.1.0'
    )

    expect(payload.schemaVersion).toBe(1)
    expect(payload.batch.title).toBe('Экспорт-тест')
    expect(payload.measurements).toHaveLength(2)
    // Замер содержит сырое значение и след коррекции — читается без приложения
    const density = payload.measurements.find((m) => m.kind === 'density')
    expect(density?.rawValue).toBe(10)
    expect((density?.corrections as { steps: unknown[] }).steps.length).toBeGreaterThan(0)
    expect(payload.measurementRevisions).toHaveLength(1) // правка pH
    expect(payload.operations).toHaveLength(1)
    expect(payload.statusHistory).toHaveLength(1) // постановка

    // JSON-сериализация валидна (контракт «читается без приложения»)
    const json = JSON.parse(JSON.stringify(payload))
    expect(json.batch.id).toBe(full.batch.id)
  })
})

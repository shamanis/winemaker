import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, type DatabaseHandle } from '../src/main/db/database'
import { applyMigrations } from '../src/main/db/migrate'
import { InstrumentRepository, YeastStrainRepository } from '../src/main/catalogs/repositories'
import { BatchRepository } from '../src/main/batches/repository'
import { MeasurementRepository, type ResolveContextProvider } from '../src/main/measurements/repository'
import type { PipelineContext } from '../src/shared/calculations/pipeline'

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

function setup(handle: DatabaseHandle) {
  const instruments = new InstrumentRepository(handle.db, () => undefined)
  const strains = new YeastStrainRepository(handle.db, () => undefined)
  const batches = new BatchRepository(handle.db, () => undefined)

  let formula: 'terrill' | 'linear' = 'terrill'

  const resolveCtx: ResolveContextProvider = (batchId, instrumentId) => {
    const batch = batches.get(batchId)
    const instrument = instrumentId ? instruments.get(instrumentId) : undefined
    const startParams = batch?.batch.startParams as {
      gravity: { raw: { unit: string; value: number }; ogSg: number; correctedBrix?: number | null }
    } | undefined
    const ctx: PipelineContext = {
      instrument: instrument
        ? {
            type: instrument.type,
            wcf: instrument.wcf,
            calibrationOffsetSg: instrument.calibrationOffsetSg,
            calibrationTempC: instrument.calibrationTempC,
            hasCalibrationPair: instrument.calibrationPair != null
          }
        : null,
      correctionFormula: formula,
      startCorrectedBrix: startParams?.gravity.correctedBrix ?? null,
      startOgSg: startParams?.gravity.ogSg ?? null,
      batchStartDateUtc: batch?.batch.startDateUtc ?? '2026-01-01T00:00:00.000Z'
    }
    return ctx
  }

  const measurements = new MeasurementRepository(handle.db, () => undefined, resolveCtx)
  return { instruments, strains, batches, measurements, setFormula: (f: 'terrill' | 'linear') => { formula = f } }
}

const BATCH_INPUT = {
  title: 'Изабелла',
  rawMaterial: 'Виноград',
  startDateUtc: '2026-11-25T10:00:00.000Z',
  startParams: { gravity: { raw: { value: 22, unit: 'brix' as const, instrumentId: null } } },
  yeast: [],
  additions: []
}

const REFRACTOMETER = {
  name: 'Рефрактометр',
  type: 'refractometer-atc',
  wcf: 1.04,
  calibrationOffsetSg: null
}

describe('MeasurementRepository', () => {
  it('create: density рефрактометром получает correctedSg (Террилл) и след', () => {
    const handle = openMemory()
    const { batches, instruments, measurements } = setup(handle)
    const batch = batches.create(BATCH_INPUT)
    const refr = instruments.create(REFRACTOMETER)

    const m = measurements.create({
      batchId: batch.batch.id,
      kind: 'density',
      instrumentId: refr.id,
      rawValue: 10,
      unit: 'brix',
      tempC: null,
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    })

    expect(m.correctedSg).toBeGreaterThan(1.0)
    expect(m.correctedSg).toBeLessThan(1.05)
    const stored = m.corrections as { steps: unknown[]; warnings: string[] }
    expect(stored.steps.length).toBeGreaterThanOrEqual(2)
    expect(stored.warnings).toHaveLength(1) // нет калибровочной пары
  })

  it('update: пишет ревизию и пересчитывает correctedSg', () => {
    const handle = openMemory()
    const { batches, instruments, measurements } = setup(handle)
    const batch = batches.create(BATCH_INPUT)
    const refr = instruments.create(REFRACTOMETER)
    const m = measurements.create({
      batchId: batch.batch.id,
      kind: 'density',
      instrumentId: refr.id,
      rawValue: 10,
      unit: 'brix',
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    })

    const updated = measurements.update(m.id, { rawValue: 12 })
    expect(updated?.rawValue).toBe(12)
    expect(updated?.correctedSg).not.toBeCloseTo(m.correctedSg as number, 6)

    const revisions = measurements.listRevisions(m.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.action).toBe('update')
    const snap = revisions[0]?.snapshot as { rawValue: number }
    expect(snap.rawValue).toBe(10) // снапшот ДО правки
  })

  it('delete: снапшот action=delete, запись удалена', () => {
    const handle = openMemory()
    const { batches, measurements } = setup(handle)
    const batch = batches.create(BATCH_INPUT)
    const m = measurements.create({
      batchId: batch.batch.id,
      kind: 'ph',
      instrumentId: null,
      rawValue: 3.4,
      unit: 'sg',
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    })
    measurements.delete(m.id)
    expect(measurements.get(m.id)).toBeUndefined()
    const revisions = measurements.listRevisions(m.id)
    expect(revisions[0]?.action).toBe('delete')
  })

  it('удаление партии каскадно удаляет замеры и ревизии', () => {
    const handle = openMemory()
    const { batches, instruments, measurements } = setup(handle)
    const batch = batches.create(BATCH_INPUT)
    const refr = instruments.create(REFRACTOMETER)
    const m = measurements.create({
      batchId: batch.batch.id,
      kind: 'density',
      instrumentId: refr.id,
      rawValue: 10,
      unit: 'brix',
      measuredAtUtc: '2026-11-26T11:00:00.000Z'
    })
    measurements.update(m.id, { rawValue: 11 })
    batches.delete(batch.batch.id)
    const count = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM measurements').get() as { n: number }
    const rev = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM measurement_revisions').get() as { n: number }
    expect(count.n).toBe(0)
    expect(rev.n).toBe(0)
  })

  it('listByBatch — хронология по времени замера', () => {
    const handle = openMemory()
    const { batches, measurements } = setup(handle)
    const batch = batches.create(BATCH_INPUT)
    measurements.create({
      batchId: batch.batch.id, kind: 'ph', instrumentId: null, rawValue: 3.5, unit: 'sg',
      measuredAtUtc: '2026-11-26T12:00:00.000Z'
    })
    measurements.create({
      batchId: batch.batch.id, kind: 'ph', instrumentId: null, rawValue: 3.4, unit: 'sg',
      measuredAtUtc: '2026-11-26T10:00:00.000Z'
    })
    const list = measurements.listByBatch(batch.batch.id)
    expect(list.map((m) => m.rawValue)).toEqual([3.4, 3.5])
  })
})

describe('калибровка прибора (2.3)', () => {
  it('calibrate: персональный WCF и пара в карточке прибора', () => {
    const handle = openMemory()
    const instruments = new InstrumentRepository(handle.db, () => undefined)
    const refr = instruments.create(REFRACTOMETER)

    const { instrument, wcf } = instruments.calibrate(refr.id, 21.5, 1.09)
    expect(wcf).toBeGreaterThan(0.9)
    expect(instrument.wcf).toBeCloseTo(wcf, 12)
    const pair = instrument.calibrationPair as { refrBrix: number; hydrometerSg: number }
    expect(pair.refrBrix).toBe(21.5)
    expect(pair.hydrometerSg).toBe(1.09)
  })

  it('calibrate: к ареометру пару применить нельзя', () => {
    const handle = openMemory()
    const instruments = new InstrumentRepository(handle.db, () => undefined)
    const hydrometer = instruments.create({
      name: 'АС-3',
      type: 'hydrometer',
      wcf: null,
      calibrationOffsetSg: null,
      calibrationTempC: 20
    })
    expect(() => instruments.calibrate(hydrometer.id, 21.5, 1.09)).toThrow('refractometer')
  })
})

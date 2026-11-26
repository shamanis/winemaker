import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, type DatabaseHandle } from '../src/main/db/database'
import { applyMigrations } from '../src/main/db/migrate'
import { InstrumentRepository, YeastStrainRepository } from '../src/main/catalogs/repositories'
import { BatchRepository } from '../src/main/batches/repository'
import { brixToSg, invertBrixToSg } from '../src/shared/calculations/density'

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

function makeRepo(handle: DatabaseHandle) {
  let dirty = 0
  const batch = new BatchRepository(handle.db, () => dirty++)
  return { batch, instruments: new InstrumentRepository(handle.db, () => dirty++), strains: new YeastStrainRepository(handle.db, () => dirty++), dirty: () => dirty }
}

const BASE_INPUT = {
  title: 'Изабелла 2026',
  rawMaterial: 'Виноград Изабелла',
  style: 'полусухое красное',
  volumeLiters: 20,
  startDateUtc: '2026-11-25T10:00:00.000Z',
  startParams: {
    gravity: { raw: { value: 22, unit: 'brix' as const, instrumentId: null } },
    ph: 3.4,
    tempC: 20
  },
  yeast: [
    {
      strainName: 'Lalvin EC-1118',
      producer: 'Lallemand',
      doseAmount: 5,
      doseUnit: 'g',
      addedAtUtc: '2026-11-25T10:05:00.000Z'
    }
  ],
  additions: [
    {
      name: 'Диаммонийфосфат',
      kind: 'nutrient',
      doseAmount: 1,
      doseUnit: 'г/л',
      addedAtUtc: '2026-11-25T10:05:00.000Z'
    }
  ]
}

describe('BatchRepository', () => {
  it('создание транзакцией: партия + OG в SG + дрожжи + добавки + история постановки', () => {
    const handle = openMemory()
    const { batch } = makeRepo(handle)

    const full = batch.create(BASE_INPUT)
    expect(full.batch.status).toBe('fermenting')
    const params = full.batch.startParams as { gravity: { raw: unknown; ogSg: number } }
    expect(params.gravity.raw).toEqual({ value: 22, unit: 'brix', instrumentId: null })
    // 22 Bx -> ~1.092 SG (формула из vision)
    expect(params.gravity.ogSg).toBeGreaterThan(1.0915)
    expect(params.gravity.ogSg).toBeLessThan(1.0925)
    expect(full.yeast).toHaveLength(1)
    expect(full.additions).toHaveLength(1)
    expect(full.history).toHaveLength(1)
    expect(full.history[0]?.fromStatus).toBeNull()
    expect(full.history[0]?.toStatus).toBe('fermenting')
  })

  it('OG вычисляется с WCF прибора при вводе в Brix', () => {
    const handle = openMemory()
    const { batch, instruments } = makeRepo(handle)
    const refractometer = instruments.create({
      name: 'Рефрактометр',
      type: 'refractometer-atc',
      wcf: 1.04,
      calibrationOffsetBx: null
    })
    const full = batch.create({
      ...BASE_INPUT,
      startParams: {
        gravity: { raw: { value: 22, unit: 'brix', instrumentId: refractometer.id } }
      }
    })
    const params = full.batch.startParams as { gravity: { ogSg: number; correctedBrix: number | null } }
    expect(params.gravity.correctedBrix).toBeCloseTo(22 * 1.04, 10)
    // WCF повышает сахаристость -> OG выше, чем без коррекции (22 Bx)
    expect(params.gravity.ogSg).toBeCloseTo(brixToSg(22 * 1.04), 12)
    expect(params.gravity.ogSg).toBeGreaterThan(brixToSg(22))
  })

  it('OG применяет смещение ареометра при вводе в SG', () => {
    const handle = openMemory()
    const { batch, instruments } = makeRepo(handle)
    const hydrometer = instruments.create({
      name: 'Ареометр АС-3',
      type: 'hydrometer',
      wcf: null,
      calibrationOffsetBx: 0.002
    })
    const full = batch.create({
      ...BASE_INPUT,
      startParams: {
        gravity: { raw: { value: 1.09, unit: 'sg', instrumentId: hydrometer.id } }
      }
    })
    const params = full.batch.startParams as { gravity: { ogSg: number } }
    // 1.09 SG → Bx → +0.002 °Bx → обратно в SG
    expect(params.gravity.ogSg).toBeCloseTo(brixToSg(invertBrixToSg(1.09) + 0.002), 10)
    expect(params.gravity.ogSg).toBeGreaterThan(1.09)
  })

  it('смена статуса дополняет append-only историю', () => {
    const handle = openMemory()
    const { batch } = makeRepo(handle)
    const created = batch.create(BASE_INPUT)

    batch.changeStatus(created.batch.id, 'slow-fermenting')
    batch.changeStatus(created.batch.id, 'aging')

    const full = batch.get(created.batch.id)
    expect(full?.batch.status).toBe('aging')
    expect(full?.history).toHaveLength(3)
    expect(full?.history.map((h) => h.toStatus)).toEqual([
      'fermenting',
      'slow-fermenting',
      'aging'
    ])
    expect(full?.history[1]?.fromStatus).toBe('fermenting')
  })

  it('архивация требует итог и пишет archivedAtUtc; повторная отклоняется', () => {
    const handle = openMemory()
    const { batch } = makeRepo(handle)
    const created = batch.create(BASE_INPUT)

    batch.archive(created.batch.id, {
      finalGravity: 0.998,
      abvPct: 12.5,
      tastingNotes: 'ягодное, сбалансированное'
    })

    const archived = batch.get(created.batch.id)
    expect(archived?.batch.status).toBe('archived')
    expect(archived?.batch.archivedAtUtc).toBeTruthy()
    const result = archived?.batch.finalResult as { abvPct: number }
    expect(result.abvPct).toBe(12.5)
    expect(archived?.history.at(-1)?.toStatus).toBe('archived')

    expect(batch.listActive()).toHaveLength(0)
    expect(batch.listArchived()).toHaveLength(1)

    expect(() => batch.archive(created.batch.id, { finalGravity: 1 })).toThrow(
      'already archived'
    )
  })

  it('удаление партии каскадно удаляет дрожжи, добавки и историю (2.4)', () => {
    const handle = openMemory()
    const { batch } = makeRepo(handle)
    const created = batch.create(BASE_INPUT)
    const id = created.batch.id
    batch.changeStatus(id, 'aging')

    batch.delete(id)

    expect(batch.get(id)).toBeUndefined()
    const yeast = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM batch_yeast').get() as { n: number }
    const additions = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM batch_additions').get() as { n: number }
    const history = handle.sqlite.prepare('SELECT COUNT(*) AS n FROM batch_status_history').get() as { n: number }
    expect(yeast.n).toBe(0)
    expect(additions.n).toBe(0)
    expect(history.n).toBe(0)
  })

  it('удаление штамма обнуляет strainId в batch_yeast, запись сохраняется (2.4)', () => {
    const handle = openMemory()
    const { batch, strains } = makeRepo(handle)
    const strain = strains.create({
      name: 'EC-1118',
      producer: 'Lallemand',
      tempMinC: null,
      tempMaxC: null,
      alcoholTolerancePct: null,
      notes: null
    })
    const created = batch.create({
      ...BASE_INPUT,
      yeast: [
        { strainId: strain.id, strainName: 'EC-1118', doseAmount: 5, doseUnit: 'g', addedAtUtc: '2026-11-25T10:05:00.000Z' }
      ]
    })

    strains.delete(strain.id)

    const full = batch.get(created.batch.id)
    expect(full?.yeast).toHaveLength(1)
    expect(full?.yeast[0]?.strainId).toBeNull()
    expect(full?.yeast[0]?.strainName).toBe('EC-1118')
  })
})

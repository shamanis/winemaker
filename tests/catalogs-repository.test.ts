import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDatabase, type DatabaseHandle } from '../src/main/db/database'
import { applyMigrations } from '../src/main/db/migrate'
import { InstrumentRepository, YeastStrainRepository } from '../src/main/catalogs/repositories'

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

describe('справочники (repositories)', () => {
  it('приборы: create/list/update/delete', () => {
    const handle = openMemory()
    const dirty: number[] = []
    const repo = new InstrumentRepository(handle.db, () => dirty.push(1))

    expect(repo.list()).toHaveLength(0)

    const created = repo.create({
      name: 'Рефрактометр РПЛ-3',
      type: 'refractometer-atc',
      wcf: 1.04,
      calibrationOffsetBx: null
    })
    expect(repo.list()).toHaveLength(1)
    expect(created.wcf).toBeCloseTo(1.04)

    const updated = repo.update(created.id, { wcf: 1.05 })
    expect(updated?.wcf).toBeCloseTo(1.05)

    repo.delete(created.id)
    expect(repo.list()).toHaveLength(0)
    expect(dirty.length).toBe(3) // create + update + delete
  })

  it('штаммы: create с диапазоном и толерантностью', () => {
    const handle = openMemory()
    const repo = new YeastStrainRepository(handle.db, () => undefined)

    const strain = repo.create({
      name: 'Lalvin EC-1118',
      producer: 'Lallemand',
      tempMinC: 10,
      tempMaxC: 30,
      alcoholTolerancePct: 18,
      notes: null
    })
    const listed = repo.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.tempMinC).toBe(10)
    expect(listed[0]?.alcoholTolerancePct).toBe(18)
    expect(strain.id).toBeTruthy()
  })
})

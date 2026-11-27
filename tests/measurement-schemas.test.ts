import { describe, expect, it } from 'vitest'
import {
  calibrateSchema,
  measurementCreateSchema,
  measurementDtoSchema
} from '../src/shared/ipc/contracts'

const BASE = {
  batchId: 'b1',
  measuredAtUtc: '2026-11-26T11:00:00.000Z'
}

describe('zod-схемы замеров', () => {
  it('density без прибора отклонён (спека 2.2)', () => {
    const r = measurementCreateSchema.safeParse({
      ...BASE,
      kind: 'density',
      rawValue: 1.09,
      unit: 'sg'
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes('instrumentId'))).toBe(true)
    }
  })

  it('density с прибором и валидным SG принят', () => {
    const r = measurementCreateSchema.safeParse({
      ...BASE,
      kind: 'density',
      instrumentId: 'i1',
      rawValue: 1.09,
      unit: 'sg',
      tempC: 25
    })
    expect(r.success).toBe(true)
  })

  it('плотность вне физического диапазона отклонена', () => {
    expect(
      measurementCreateSchema.safeParse({
        ...BASE, kind: 'density', instrumentId: 'i1', rawValue: 1.5, unit: 'sg'
      }).success
    ).toBe(false)
    expect(
      measurementCreateSchema.safeParse({
        ...BASE, kind: 'density', instrumentId: 'i1', rawValue: 120, unit: 'brix'
      }).success
    ).toBe(false)
  })

  it('temperature/ph принимаются без прибора; диапазоны проверяются', () => {
    expect(
      measurementCreateSchema.safeParse({ ...BASE, kind: 'ph', rawValue: 3.4, unit: 'sg' }).success
    ).toBe(true)
    expect(
      measurementCreateSchema.safeParse({ ...BASE, kind: 'ph', rawValue: 15, unit: 'sg' }).success
    ).toBe(false)
    expect(
      measurementCreateSchema.safeParse({ ...BASE, kind: 'temperature', rawValue: 22, unit: 'sg' }).success
    ).toBe(true)
    expect(
      measurementCreateSchema.safeParse({ ...BASE, kind: 'temperature', rawValue: 100, unit: 'sg' }).success
    ).toBe(false)
  })

  it('калибровочная пара: диапазоны входов', () => {
    expect(calibrateSchema.safeParse({ instrumentId: 'i1', refrBrix: 21.5, hydrometerBx: 21 }).success).toBe(true)
    expect(calibrateSchema.safeParse({ instrumentId: 'i1', refrBrix: 90, hydrometerBx: 21 }).success).toBe(false)
    expect(calibrateSchema.safeParse({ instrumentId: 'i1', refrBrix: 21.5, hydrometerBx: 95 }).success).toBe(false)
  })

  it('доменные сообщения проверки — ключи каталога (design D8)', () => {
    const r = measurementCreateSchema.safeParse({
      ...BASE, kind: 'density', rawValue: 1.09, unit: 'sg'
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes('instrumentId'))
      expect(issue?.message).toBe('errors.instrumentRequired')
    }
  })

  it('след без машинных кодов (запись старого вида) проходит схему (design D6)', () => {
    const r = measurementDtoSchema.safeParse({
      id: 'm1',
      batchId: 'b1',
      kind: 'density',
      instrumentId: 'i1',
      rawValue: 22,
      unit: 'brix',
      tempC: 20,
      correctedSg: 1.0920,
      correctedBrix: 22,
      corrections: {
        steps: [{ type: 'wcf', input: 22, output: 22.88, note: 'Персональный WCF из калибровочной пары: 1.04' }],
        warnings: ['У рефрактометра нет персонального WCF']
      },
      measuredAtUtc: '2026-11-26T11:00:00.000Z',
      notes: null,
      createdAtUtc: '2026-11-26T11:00:00.000Z',
      updatedAtUtc: '2026-11-26T11:00:00.000Z'
    })
    expect(r.success).toBe(true)
  })

  it('след с кодами и параметрами проходит схему', () => {
    const r = measurementDtoSchema.safeParse({
      id: 'm2',
      batchId: 'b1',
      kind: 'density',
      instrumentId: 'i1',
      rawValue: 22,
      unit: 'brix',
      tempC: null,
      correctedSg: 1.0920,
      correctedBrix: 22.88,
      corrections: {
        steps: [
          {
            type: 'wcf',
            input: 22,
            output: 22.88,
            note: 'Персональный WCF из калибровочной пары: 1.04',
            code: 'trace.wcfFromPair',
            params: { wcf: 1.04 }
          }
        ],
        warnings: [],
        warningCodes: []
      },
      measuredAtUtc: '2026-11-26T11:00:00.000Z',
      notes: null,
      createdAtUtc: '2026-11-26T11:00:00.000Z',
      updatedAtUtc: '2026-11-26T11:00:00.000Z'
    })
    expect(r.success).toBe(true)
  })
})

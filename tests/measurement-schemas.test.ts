import { describe, expect, it } from 'vitest'
import { calibrateSchema, measurementCreateSchema } from '../src/shared/ipc/contracts'

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
})

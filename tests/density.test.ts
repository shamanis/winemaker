import { describe, expect, it } from 'vitest'
import {
  brixToSg,
  resolveOgSg,
  type GravityInstrument
} from '../src/shared/calculations/density'

describe('brixToSg (формула из vision)', () => {
  it('0 °Bx — вода, SG ровно 1.000', () => {
    expect(brixToSg(0)).toBe(1)
  })

  it('22 °Bx ≈ 1.0920 (винодельческий ориентир)', () => {
    // Формула: 1 + 22 / (258.6 - (22/258.2)*227.1)
    const expected = 1 + 22 / (258.6 - (22 / 258.2) * 227.1)
    expect(brixToSg(22)).toBeCloseTo(expected, 12)
    expect(brixToSg(22)).toBeGreaterThan(1.0915)
    expect(brixToSg(22)).toBeLessThan(1.0925)
  })

  it('монотонно растёт по сахару', () => {
    expect(brixToSg(10)).toBeLessThan(brixToSg(20))
    expect(brixToSg(20)).toBeLessThan(brixToSg(40))
  })
})

describe('resolveOgSg — OG всегда в SG (design D7)', () => {
  const refractometer: GravityInstrument = {
    type: 'refractometer-atc',
    wcf: 1.04,
    calibrationOffsetSg: null
  }
  const hydrometer: GravityInstrument = {
    type: 'hydrometer',
    wcf: null,
    calibrationOffsetSg: 0.002
  }

  it('Brix: применяет WCF прибора до перевода в SG', () => {
    const { ogSg, correctedBrix } = resolveOgSg(
      { value: 22, unit: 'brix' },
      refractometer
    )
    expect(correctedBrix).toBeCloseTo(22 * 1.04, 10)
    expect(ogSg).toBeCloseTo(brixToSg(22 * 1.04), 12)
  })

  it('Brix без прибора: WCF = 1.0', () => {
    const { ogSg, correctedBrix } = resolveOgSg({ value: 22, unit: 'brix' }, null)
    expect(correctedBrix).toBe(22)
    expect(ogSg).toBeCloseTo(brixToSg(22), 12)
  })

  it('SG: применяет калибровочное смещение ареометра', () => {
    const { ogSg, correctedBrix } = resolveOgSg(
      { value: 1.09, unit: 'sg' },
      hydrometer
    )
    expect(ogSg).toBeCloseTo(1.092, 12)
    expect(correctedBrix).toBeNull()
  })

  it('SG без прибора: значение без изменений', () => {
    const { ogSg } = resolveOgSg({ value: 1.09, unit: 'sg' }, null)
    expect(ogSg).toBe(1.09)
  })
})

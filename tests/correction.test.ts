import { describe, expect, it } from 'vitest'
import {
  computePersonalWcf,
  correctHydrometerTemp,
  invertBrixToSg,
  isTempOutOfApproximation,
  linearCorrection,
  terrillCorrection
} from '../src/shared/calculations/correction'
import { brixToSg } from '../src/shared/calculations/density'

describe('темп-коррекция ареометра (формула из vision, S=1.050)', () => {
  it('якоря таблицы vision: 15/20/25/30 °C', () => {
    expect(correctHydrometerTemp(1.05, 20)).toBeCloseTo(1.05, 10)
    expect(correctHydrometerTemp(1.05, 25)).toBeCloseTo(1.0519425, 8)
    expect(correctHydrometerTemp(1.05, 30)).toBeCloseTo(1.053885, 8)
    expect(correctHydrometerTemp(1.05, 15)).toBeCloseTo(1.0480575, 8)
  })

  it('T_кал прибора смещает поправку (старый ареометр с T_кал=15 °C)', () => {
    // При T=20 и T_кал=15 поправка такая же, как при T=25 и T_кал=20
    expect(correctHydrometerTemp(1.05, 20, 15)).toBeCloseTo(1.0519425, 8)
  })

  it('зоны предупреждения: <10 и >35 °C вне аппроксимации', () => {
    expect(isTempOutOfApproximation(20)).toBe(false)
    expect(isTempOutOfApproximation(15)).toBe(false)
    expect(isTempOutOfApproximation(30)).toBe(false)
    expect(isTempOutOfApproximation(9)).toBe(true)
    expect(isTempOutOfApproximation(36)).toBe(true)
  })
})

describe('инверсия SG → Brix', () => {
  it('brixToSg(invertBrixToSg(x)) ≈ x', () => {
    for (const sg of [1.0, 1.05, 1.092, 1.1]) {
      expect(brixToSg(invertBrixToSg(sg))).toBeCloseTo(sg, 9)
    }
  })

  it('инверсия воды — 0 °Bx', () => {
    expect(invertBrixToSg(1)).toBeCloseTo(0, 6)
  })
})

describe('Террилл (кубическая формула из vision)', () => {
  it('контрольный пример Bi=22, Bf=10 ≈ 1.0109 SG', () => {
    const expected =
      1 -
      0.0044993 * 22 +
      0.011774 * 10 +
      0.00027581 * 22 ** 2 -
      0.0012717 * 10 ** 2 -
      0.00000728 * 22 ** 3 +
      0.000063293 * 10 ** 3
    expect(terrillCorrection(22, 10)).toBeCloseTo(expected, 12)
    expect(terrillCorrection(22, 10)).toBeGreaterThan(1.0107)
    expect(terrillCorrection(22, 10)).toBeLessThan(1.0110)
  })

  it('дображивание до исходного сахара возвращает OG-область', () => {
    // Bf = Bi → SG близок к SG старта (22 Bx ≈ 1.092)
    expect(terrillCorrection(22, 22)).toBeGreaterThan(1.085)
  })
})

describe('линейная коррекция (Баллинг)', () => {
  it('RE = 0.1808·Bi + 0.8192·Bf → SG', () => {
    const re = 0.1808 * 22 + 0.8192 * 10
    expect(linearCorrection(22, 10)).toBeCloseTo(brixToSg(re), 12)
  })
})

describe('калибровочная пара', () => {
  it('WCF = истинный Brix (из SG) / сырой Brix', () => {
    const wcf = computePersonalWcf(21.5, 1.09)
    expect(wcf).toBeCloseTo(invertBrixToSg(1.09) / 21.5, 12)
    expect(wcf).toBeGreaterThan(0.9)
    expect(wcf).toBeLessThan(1.2)
  })
})

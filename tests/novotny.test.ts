import { describe, expect, it } from 'vitest'
import {
  apparentExtractBx,
  novotny
} from '../src/shared/calculations/novotny'
import { brixToSg } from '../src/shared/calculations/density'

/**
 * Контрольные точки модели из docs/refractometer.md (B₀ = 22 °Bx):
 * | R  | B     | SG_app | ABV  |
 * | 22 | 22.00 | 1.092  | 0.0  |
 * | 18 | 16.77 | 1.064  | 3.4  |
 * | 16 | 14.2  | 1.050  | 5.0  |
 * | 12 | 9.1   | 1.025  | 8.2  |
 * | 8  | 4.0   | 1.000  | 11.2 |
 */
const CONTROL_POINTS = [
  { r: 22, b: 22.0, sg: 1.092, abv: 0.0 },
  { r: 18, b: 16.77, sg: 1.064, abv: 3.4 },
  { r: 16, b: 14.2, sg: 1.05, abv: 5.0 },
  { r: 12, b: 9.1, sg: 1.025, abv: 8.2 },
  { r: 8, b: 4.0, sg: 1.0, abv: 11.2 }
]

describe('Novotný двухкомпонентная модель (контрольные точки docs)', () => {
  for (const cp of CONTROL_POINTS) {
    it(`R=${cp.r} °Bx → B=${cp.b}, SG_app=${cp.sg}, ABV=${cp.abv}`, () => {
      const n = novotny(cp.r, 22)
      expect(n.converged).toBe(true)
      expect(n.trueExtractBx).toBeCloseTo(cp.b, 1)
      expect(n.apparentSg).toBeCloseTo(cp.sg, 2)
      expect(n.abvPct).toBeCloseTo(cp.abv, 1)
    })
  }

  it('при R = B₀ сходится мгновенно и возвращает исходное сусло', () => {
    const n = novotny(22, 22)
    expect(n.trueExtractBx).toBe(22)
    expect(n.apparentSg).toBeCloseTo(brixToSg(22), 10)
    expect(n.abvPct).toBe(0)
  })
})

describe('вспомогательные соотношения', () => {
  it('apparentExtractBx: AE = (B − 0.1808·B₀) / 0.8192', () => {
    expect(apparentExtractBx(16.77, 22)).toBeCloseTo((16.77 - 0.1808 * 22) / 0.8192, 10)
  })
})

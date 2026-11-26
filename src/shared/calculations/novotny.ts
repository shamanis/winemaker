import { brixToSg } from './density'

/**
 * Двухкомпонентная физическая модель Новотного (ред. Asher, 2021) —
 * основная коррекция рефрактометра на ходу брожения
 * (docs/refractometer.md «Коррекция после начала брожения»).
 *
 * Рефрактометр «видит» экстракт и спирт: R = B + c·A.
 * Закон Баллинга: A = (B₀ − B) · 0.484 · ρ(B) / 0.794.
 * Решение — простая итерация B⁽ⁿ⁺¹⁾ = R − c·A(B⁽ⁿ⁾).
 */

/** Оптический коэффициент спирта, °Bx на 1 % об. (константа модели). */
export const ALCOHOL_OPTICAL_COEFF_BX = 0.36
/** Баллинг-фактор перехода сахара в спирт. */
const BALLING_FACTOR = 0.484
/** Плотность абсолютного спирта, г/мл. */
const ALCOHOL_DENSITY = 0.794
/** Домен Террилла: показание должно опуститься до 0.6 от OG (docs). */
export const TERRILL_DOMAIN_RATIO = 0.6

export interface NovotnyResult {
  /** Истинный (остаточный) экстракт B, °Bx. */
  trueExtractBx: number
  /** Текущая крепость A, % об. — из той же системы уравнений. */
  abvPct: number
  /**
   * Кажущаяся плотность (Apparent SG) — основное значение для графика
   * и расчётов, сопоставимое с показаниями ареометра.
   */
  apparentSg: number
  apparentExtractBx: number
  iterations: number
  converged: boolean
}

/** Текущая крепость A по закону Баллинга, % об. */
export function alcoholAt(extractBx: number, initialBx: number): number {
  return (
    (initialBx - extractBx) *
    BALLING_FACTOR *
    (brixToSg(extractBx) / ALCOHOL_DENSITY)
  )
}

/** Кажущийся экстракт AE из истинного, °Bx (соотношение Баллинга). */
export function apparentExtractBx(trueExtractBx: number, initialBx: number): number {
  return (trueExtractBx - 0.1808 * initialBx) / 0.8192
}

/**
 * Решает двухкомпонентную модель итерациями (сходимость за ~10 итераций;
 * при R = B₀ сходится мгновенно и возвращает плотность исходного сусла).
 */
export function novotny(
  readingBx: number,
  initialExtractBx: number,
  maxIterations = 50
): NovotnyResult {
  // Физика: текущее показание не может превышать плотность исходного сусла
  // (алкоголь лишь понижает). R > B₀ — артефакт ввода/погрешности.
  const r = Math.min(readingBx, initialExtractBx)
  let b = r
  let iterations = 0
  let converged = false
  for (; iterations < maxIterations; iterations++) {
    const next = readingBx - ALCOHOL_OPTICAL_COEFF_BX * alcoholAt(b, initialExtractBx)
    iterations++
    if (Math.abs(next - b) < 1e-10) {
      b = next
      converged = true
      iterations++
      break
    }
    b = next
  }
  const abvPct = alcoholAt(b, initialExtractBx)
  const apparentExtractBxValue = apparentExtractBx(b, initialExtractBx)
  return {
    trueExtractBx: b,
    abvPct,
    apparentSg: brixToSg(apparentExtractBxValue),
    apparentExtractBx: apparentExtractBxValue,
    iterations,
    converged
  }
}

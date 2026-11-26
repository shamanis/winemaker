import { invertBrixToSg } from './correction'

/**
 * Аналитика брожения (vision «Специфика предметной области», формула Hall).
 * Все расчёты — только по скорректированным значениям в SG (спека 2.10/4.5).
 */

/** ABV по формуле Hall, % об. */
export function hallAbv(ogSg: number, fgSg: number): number {
  return ((76.08 * (ogSg - fgSg)) / (1.775 - ogSg)) * (fgSg / 0.794)
}

/** Видимая степень сбраживания, % (может превышать 100 при FG < 1.000). */
export function apparentAttenuation(ogSg: number, fgSg: number): number {
  return ((ogSg - fgSg) / (ogSg - 1)) * 100
}

/**
 * Остаточный сахар, г/л: экстракт по Баллингу
 * RE = 0.1808·OE + 0.8192·AE (°P), затем 1 °P ≈ 1 г/100 г → RE × FG × 10.
 */
export function residualSugar(ogSg: number, fgSg: number): number {
  const oe = invertBrixToSg(ogSg)
  const ae = invertBrixToSg(fgSg)
  const re = 0.1808 * oe + 0.8192 * ae
  return re * fgSg * 10
}

/** Целевая плотность прогноза («сухое») — константа этапа (design D1). */
export const FORECAST_TARGET_SG = 0.999

export type Forecast =
  | { kind: 'range'; fromUtc: string; toUtc: string; targetSg: number }
  | { kind: 'insufficient-data'; message: string }
  | { kind: 'not-declining'; message: string }

export interface ForecastPoint {
  atUtc: string
  sg: number
}

const MIN_POINTS = 3
const MIN_SPAN_MS = 48 * 3600_000

function slopePerDay(points: ForecastPoint[]): number {
  const xs = points.map((p) => Date.parse(p.atUtc) / 86_400_000)
  const ys = points.map((p) => p.sg)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my)
    den += (xs[i]! - mx) ** 2
  }
  if (den === 0) return 0
  return num / den
}

function eta(last: ForecastPoint, slope: number, targetSg: number): string {
  const lastMs = Date.parse(last.atUtc)
  const days = (targetSg - last.sg) / slope
  return new Date(lastMs + days * 86_400_000).toISOString()
}

/**
 * Прогноз завершения активного брожения — диапазоном (спека 6.3.6).
 * Два наклона линейной регрессии (всё окно и последние три точки) дают
 * два ETA достижения целевой плотности; диапазон = [min, max + сутки].
 */
export function forecastCompletion(
  points: ForecastPoint[],
  targetSg: number = FORECAST_TARGET_SG
): Forecast {
  const sorted = [...points].sort((a, b) => a.atUtc.localeCompare(b.atUtc))
  if (sorted.length < MIN_POINTS) {
    return {
      kind: 'insufficient-data',
      message: `Нужно хотя бы ${MIN_POINTS} замера плотности`
    }
  }
  const span = Date.parse(sorted.at(-1)!.atUtc) - Date.parse(sorted[0]!.atUtc)
  if (span < MIN_SPAN_MS) {
    return {
      kind: 'insufficient-data',
      message: 'Замеры должны покрывать не менее 48 часов'
    }
  }

  const slopeAll = slopePerDay(sorted)
  const slopeRecent = slopePerDay(sorted.slice(-3))
  if (slopeAll >= -1e-6 || slopeRecent >= -1e-6) {
    return {
      kind: 'not-declining',
      message: 'Плотность не снижается — завершение по текущей динамике не прогнозируется'
    }
  }

  const last = sorted.at(-1)!
  const etas = [eta(last, slopeAll, targetSg), eta(last, slopeRecent, targetSg)].sort()
  const from = etas[0]!
  const to = new Date(Date.parse(etas[1]!) + 86_400_000).toISOString()
  return { kind: 'range', fromUtc: from, toUtc: to, targetSg }
}

/* ── Форматтеры (спеки 6.3.1, 6.3.2) ── */

/** Крепость — всегда с «% об.» (6.3.2), без исключений. */
export function formatAbv(abv: number | null | undefined): string {
  if (abv == null || !Number.isFinite(abv)) return '—'
  return `${abv.toFixed(1)} % об.`
}

/**
 * Плотность — ОБЕ единицы рядом всегда (правило интерфейса: SG нужен
 * формулам, Brix нагляднее людям). Рабочая единица из настроек — первой,
 * вторая — в скобках.
 */
export function formatDensity(sg: number | null | undefined, unit: 'sg' | 'brix'): string {
  if (sg == null || !Number.isFinite(sg)) return '—'
  const sgPart = `${sg.toFixed(4)} SG`
  const brixPart = `${invertBrixToSg(sg).toFixed(1)} °Bx`
  return unit === 'brix' ? `${brixPart} (${sgPart})` : `${sgPart} (${brixPart})`
}

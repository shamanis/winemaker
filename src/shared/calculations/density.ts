/**
 * Пересчёт плотности (vision «Специфика предметной области»).
 *
 * Brix -> SG по конвенции индустрии: OG всегда хранится в SG (design D7).
 * Формула: OG = 1 + Bi / (258.6 - (Bi / 258.2) * 227.1), где Bi —
 * скорректированное показание рефрактометра в Brix.
 */

/** Переводит показание в Brix в удельную плотность SG. */
export function brixToSg(brix: number): number {
  return 1 + brix / (258.6 - (brix / 258.2) * 227.1)
}

/** Минимальный физический диапазон входных значений (design Risks). */
export const BRIX_MIN = 0
export const BRIX_MAX = 80
export const SG_MIN = 0.9
export const SG_MAX = 1.2

/** Параметры прибора, нужные для вычисления OG. */
export interface GravityInstrument {
  readonly type: string
  readonly wcf: number | null
  readonly calibrationOffsetSg: number | null
}

export interface RawGravityInput {
  readonly value: number
  readonly unit: 'sg' | 'brix'
}

export interface ResolvedOg {
  /** OG в SG — единственное значение для всех последующих расчётов. */
  readonly ogSg: number
  /** Скорректированное показание в Brix (для ввода рефрактометром). */
  readonly correctedBrix: number | null
}

/**
 * Вычисляет OG в SG из сырого показания с учётом прибора:
 * Brix -> WCF прибора (по умолчанию 1.0) -> формула; SG -> калибровочное
 * смещение ареометра. Температурная коррекция — этап measurement-correction.
 */
export function resolveOgSg(raw: RawGravityInput, instrument: GravityInstrument | null): ResolvedOg {
  if (raw.unit === 'brix') {
    const correctedBrix = raw.value * (instrument?.wcf ?? 1)
    return { ogSg: brixToSg(correctedBrix), correctedBrix }
  }
  return { ogSg: raw.value + (instrument?.calibrationOffsetSg ?? 0), correctedBrix: null }
}

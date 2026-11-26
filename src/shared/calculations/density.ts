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
/**
 * Численное обращение монотонной `brixToSg` (бисекция до 1e-9).
 * Нужно для смещения ареометра в °Bx при вводе в SG и для калибровочной пары.
 */
export function invertBrixToSg(sg: number): number {
  let lo = 0
  let hi = 120
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2
    if (brixToSg(mid) < sg) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface GravityInstrument {
  readonly type: string
  readonly wcf: number | null
  /** Смещение показаний ареометра, °Bx (аддитивное, в шкале прибора). */
  readonly calibrationOffsetBx: number | null
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
  const isRefractometer = instrument != null && instrument.type.startsWith('refractometer')
  if (raw.unit === 'brix') {
    // Рефрактометр: WCF; ареометр в Brix: аддитивное смещение °Bx
    const correctedBrix = isRefractometer
      ? raw.value * (instrument?.wcf ?? 1)
      : raw.value + (instrument?.calibrationOffsetBx ?? 0)
    return { ogSg: brixToSg(correctedBrix), correctedBrix }
  }
  // SG: показание уже в SG; смещение ареометра (в °Bx) применяется
  // в Bx-пространстве: инверсия → смещение → обратно в SG
  const offsetBx = instrument?.calibrationOffsetBx ?? 0
  if (offsetBx === 0) return { ogSg: raw.value, correctedBrix: null }
  const b = invertBrixToSg(raw.value) + offsetBx
  return { ogSg: brixToSg(b), correctedBrix: null }
}

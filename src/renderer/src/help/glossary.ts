/**
 * Списки идентификаторов формул и глоссария (спека glossary).
 * Все тексты — определения, заголовки, пояснения и записи формул —
 * живут в каталоге переводов (help.term.*, help.termDesc.*,
 * help.formulas.*); математика формул та же, что реализована
 * в shared/calculations.
 */

export const GLOSSARY_ORDER: string[] = [
  'sg',
  'og',
  'fg',
  'brix',
  'atc',
  'wcf',
  'abv',
  'ph',
  'tcal',
  'ferment'
]

export const FORMULA_IDS: string[] = [
  'brixToSg',
  'calibrationPair',
  'hydrometerCorrection',
  'novotny',
  'terrill',
  'linear',
  'hall'
]

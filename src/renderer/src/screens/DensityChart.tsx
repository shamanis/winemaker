import { useEffect, useMemo, type ReactElement } from 'react'
import type { MeasurementDto } from '@shared/ipc/contracts'
import { brixToSg } from '@shared/calculations/density'
import { useCatalogsStore } from '../store/catalogs-store'

const WIDTH = 640
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 36, left: 56 }

type MarkerShape = 'circle' | 'diamond' | 'square'

function shapeFor(type: string | undefined): MarkerShape {
  if (type === 'hydrometer') return 'circle'
  if (type?.startsWith('refractometer')) return 'diamond'
  return 'square'
}

function renderMarker(shape: MarkerShape, cx: number, cy: number, key: string, onOpen: () => void, muted = false): ReactElement {
  const common = {
    role: 'button' as const,
    tabIndex: 0,
    className: muted ? 'chart-point chart-point-raw' : 'chart-point',
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') onOpen()
    }
  }
  if (shape === 'circle') return <circle key={key} cx={cx} cy={cy} r={muted ? 3.5 : 5} {...common} />
  if (shape === 'diamond') {
    const r = muted ? 4.5 : 6
    const pts = `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
    return <polygon key={key} points={pts} {...common} />
  }
  const s = muted ? 8 : 10
  return <rect key={key} x={cx - s / 2} y={cy - s / 2} width={s} height={s} {...common} />
}

interface ChartPoint {
  id: string
  corrected: number
  raw: number
  t: number
  shape: MarkerShape
}

/**
 * График динамики плотности (спека density-chart): основная линия —
 * скорректированные значения (истина), вторым приглушённым слоем — сырые
 * показания («сырые/факт»); маркеры по приборам, точка → карточка замера.
 */
export function DensityChart(props: {
  measurements: MeasurementDto[]
  onOpen(measurementId: string): void
}): ReactElement {
  const { measurements, onOpen } = props
  const instruments = useCatalogsStore((s) => s.instruments)
  const catalogsLoaded = useCatalogsStore((s) => s.loaded)
  const initCatalogs = useCatalogsStore((s) => s.init)

  // Маркеры по приборам требуют справочника — вкладка может открываться
  // без посещения Справочников.
  useEffect(() => {
    if (!catalogsLoaded) void initCatalogs()
  }, [catalogsLoaded, initCatalogs])

  const points = useMemo(
    () =>
      measurements
        .filter((m) => m.kind === 'density' && m.correctedSg != null)
        .map((m) => {
          const instrument = instruments.find((i) => i.id === m.instrumentId)
          const raw =
            m.unit === 'brix'
              ? brixToSg(m.rawValue)
              : m.rawValue
          return {
            id: m.id,
            corrected: m.correctedSg as number,
            raw,
            t: Date.parse(m.measuredAtUtc),
            shape: shapeFor(instrument?.type)
          }
        })
        .sort((a, b) => a.t - b.t),
    [measurements, instruments]
  )

  if (points.length === 0) {
    return <p className="muted">Пока нет плотностей для графика.</p>
  }

  const tMin = points[0]!.t
  const tMax = points.at(-1)!.t
  // Единая шкала по обеим сериям (сырые всегда ≥ скорректированных).
  const allSgs = points.flatMap((p) => [p.corrected, p.raw])
  const yMin = Math.min(...allSgs) - 0.006
  const yMax = Math.max(...allSgs) + 0.006
  // Ось времени: не даём окну схлопнуться на 1–2 точках —
  // разворачиваем минимум на ±3 суток вокруг данных.
  const DAY = 86_400_000
  const spanT = Math.max(tMax - tMin, 6 * DAY)
  const xMin = tMin - 1.5 * DAY
  const xMax = tMax + 1.5 * DAY
  const spanY = Math.max(yMax - yMin, 1e-6)

  const px = (t: number): number =>
    PAD.left + ((t - xMin) / spanT) * (WIDTH - PAD.left - PAD.right)
  const py = (sg: number): number =>
    PAD.top + (1 - (sg - yMin) / spanY) * (HEIGHT - PAD.top - PAD.bottom)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.t)},${py(p.corrected)}`).join(' ')
  const rawLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.t)},${py(p.raw)}`).join(' ')
  const fmtDate = (t: number): string => new Date(t).toISOString().slice(5, 10)
  const fmtSg = (sg: number): string => sg.toFixed(3)

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="График плотности" className="chart-svg">
        {/* Оси */}
        <line x1={PAD.left} y1={HEIGHT - PAD.bottom} x2={WIDTH - PAD.right} y2={HEIGHT - PAD.bottom} className="chart-axis" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={HEIGHT - PAD.bottom} className="chart-axis" />
        <text x={PAD.left} y={PAD.top - 2} className="chart-label">{fmtSg(yMax)}</text>
        <text x={PAD.left} y={HEIGHT - PAD.bottom + 14} className="chart-label">{fmtSg(yMin)}</text>
        <text x={PAD.left} y={HEIGHT - PAD.bottom + 28} className="chart-label">{fmtDate(xMin)}</text>
        <text x={WIDTH - PAD.right} y={HEIGHT - PAD.bottom + 28} className="chart-label" textAnchor="end">{fmtDate(xMax)}</text>
        <text x={PAD.left - 6} y={py(1)} className="chart-label" textAnchor="end">1.000</text>
        <line x1={PAD.left} y1={py(1)} x2={WIDTH - PAD.right} y2={py(1)} className="chart-waterline" />

        {/* Сырые показания: пунктирная линия + приглушённые точки («до коррекции») */}
        {points.length > 1 ? <path d={rawLine} className="chart-line-raw" /> : null}
        {points.map((p) =>
          renderMarker(p.shape, px(p.t), py(p.raw), `raw-${p.id}`, () => onOpen(p.id), true)
        )}

        {/* Скорректированные (факт): основная линия и маркеры */}
        <path d={line} className="chart-line" />
        {points.map((p) =>
          renderMarker(p.shape, px(p.t), py(p.corrected), `corr-${p.id}`, () => onOpen(p.id))
        )}
      </svg>
      <figcaption className="chart-legend">
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="5" className="chart-marker-hydro" /></svg> ареометр</span>
        <span><svg width="12" height="12"><polygon points="6,1 11,6 6,11 1,6" className="chart-marker-refr" /></svg> рефрактометр</span>
        <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" className="chart-marker-other" /></svg> иной прибор</span>
        <span className="muted">━ скорректированные · ┄ сырые</span>
      </figcaption>
    </figure>
  )
}

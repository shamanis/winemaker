# Tasks

## 1. Расчётное ядро

- [x] 1.1 density.ts: invertBrixToSg рядом с brixToSg; resolveOgSg — SG-путь через инверсию + смещение °Bx, Bx-путь — смещение °Bx для ареометра
- [x] 1.2 correction.ts: computePersonalWcf = hydrometerBx / refrBrix (прямое отношение), реэкспорт invertBrixToSg
- [x] 1.3 pipeline.ts: ветка ареометра в Bx-пространстве (sg-to-brix → calibration-offset → hydrometer-temp на SG), след коррекции с человеческими нотами

## 2. Данные и IPC

- [x] 2.1 schema.ts: instruments.calibrationOffsetBx (переименование с _sg)
- [x] 2.2 Рукописная миграция 0004 (SQL + journal + snapshot, цепочка 0000–0004 целая)
- [x] 2.3 calibrate(instrumentId, refrBrix, hydrometerBx) в InstrumentRepository; CalibrationPair.hydrometerBx
- [x] 2.4 Контракты IPC: calibrationOffsetBx (±5 °Bx), hydrometerBx (0–80), провайдер контекста пайплайна

## 3. UI

- [x] 3.1 Форма прибора: поле «Калибровочное смещение» в °Bx
- [x] 3.2 Диалог калибровки: оба показания в °Bx с подсказкой

## 4. Тесты

- [x] 4.1 density: SG без прибора без изменений; SG + смещение в Bx-пространстве; Bx + смещение
- [x] 4.2 correction: WCF из пары в Bx
- [x] 4.3 pipeline: след ареометра [sg-to-brix, calibration-offset, hydrometer-temp]; темп при T = T_кал не меняет значение
- [x] 4.4 repositories: calibrate(20, 21) → WCF 1.05; OG партии со смещением ареометра в Bx
- [x] 4.5 typecheck + полный прогон зелёный

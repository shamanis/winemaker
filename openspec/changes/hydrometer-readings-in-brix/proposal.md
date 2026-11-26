# Proposal

## Why

Приборы пользователя (ареометры АС-3) имеют только шкалу Brix — они физически не показывают SG. Сейчас калибровка рефрактометра запрашивает показание ареометра в SG, а калибровочное смещение ареометра задаётся в SG: пользователь не может снять эти значения со своего прибора без ручного пересчёта. Все величины ареометра переходим в °Bx (читаются с прибора напрямую), SG остаётся каноническим для расчётов (design D7 не меняется).

## What Changes

- Калибровочная пара «рефрактометр — ареометр»: оба показания в °Bx; персональный WCF = (ареометр °Bx) / (рефрактометр °Bx) — прямое отношение без инверсии.
- Калибровочное смещение ареометра — в °Bx, аддитивное в Bx-пространстве (раньше было в SG).
- Замер ареометром вводится в °Bx по умолчанию; ввод в SG поддерживается — значение приводится к шкале Brix (инверсия формулы Brix→SG), и все поправки применяются в Bx-пространстве.
- Температурная коррекция: SG₀ = brixToSg(B) → SG = SG₀ × (1 + 3.7e-4 × (T − T_кал)) — формула не меняется, применяется после приведения к SG.
- Миграция 0004: колонка `instruments.calibration_offset_sg` → `calibration_offset_bx` (значения переинтерпретируются; у пользователя приборы без заданного смещения — потери нет).
- OG при старте партии: ареометр в Bx — смещение в Bx-пространстве, затем brixToSg; ввод в SG — инверсия → смещение → brixToSg.

## Capabilities

### New Capabilities

Отсутствуют.

### Modified Capabilities

- `measurement-correction`: температурная коррекция и ввод ареометра — в шкале Brix; смещение ареометра в °Bx; калибровочная пара — оба показания в °Bx, WCF — прямое отношение.
- `reference-catalogs`: справочник приборов — смещение ареометра задаётся в °Bx.

## Impact

- `src/shared/calculations/density.ts` — resolveOgSg: SG-путь через инверсию; invertBrixToSg переехал сюда (рядом с brixToSg, без цикла импортов).
- `src/shared/calculations/correction.ts` — computePersonalWcf = hydrometerBx / refrBrix; реэкспорт invertBrixToSg.
- `src/shared/calculations/pipeline.ts` — ветка ареометра переписана в Bx-пространстве (sg-to-brix → offset → temp на SG).
- `src/main/db/schema.ts` + миграция 0004 (рукописный SQL: drop/add колонки) + snapshot/journal.
- `src/main/catalogs/repositories.ts` — calibrate(instrumentId, refrBrix, hydrometerBx).
- IPC-контракты и UI: поля hydrometerBx / calibrationOffsetBx с подписями «°Bx»; тесты всех затронутых модулей.

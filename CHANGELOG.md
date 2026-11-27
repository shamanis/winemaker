# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — Unreleased

### Added

- English interface. The language is selected in Settings — "System default", Русский or English — with instant switching and no restart. Until an explicit choice is made, the interface follows the operating system language (Russian systems get Russian, everything else gets English).
- The native application menu is localized too and rebuilds when the language changes.
- Help content — the winemaking glossary and the formula explanations — is available in both languages.
- README in English and Russian, screenshots of the main screen in both languages, the MIT license, and this changelog.

### Changed

- The correction trace stored with every measurement now keeps machine codes with parameters next to the human-readable text, so the trace is always rendered in the current interface language. The saved text stays in exports and keeps them readable without the app; measurements recorded before this change still show their stored text.
- Validation and domain error messages are localized to the interface language.
- Unit labels are part of localization: strength is shown as "% ABV" in English and «% об.» in Russian.
- Primary actions in dialogs and forms are filled with the accent color, destructive buttons are filled red, and the measurement save button simply reads "Save" (Enter still saves).

### Fixed

- "Delete…" on an open batch card did nothing — the confirmation dialog never appeared.
- Inputs inside modal dialogs lost the application styling and rendered with system defaults.

## [0.1.0] — 2026-11-26

First MVP release: a fully local winemaking assistant for Windows, macOS and Linux. Your data never leaves your machine.

### Added

**Batch management**

- Batches with a status lifecycle: Fermenting → Finishing fermentation → Aging → Bottling → Archived, with a full status history.
- Starting parameters: raw gravity reading, OG always computed and stored in SG (dual-unit display, SG + °Bx), pH, must temperature, volume, start date.
- Yeast and starting additions come only from your own catalogs — a strain is picked from the list or created on the spot ("exactly one way"); renaming a strain in the catalog updates existing batches, and records keep a snapshot in case the strain is deleted.
- Archiving with final characteristics (final gravity, ABV, tasting notes); batch deletion with cascade and confirmation.

**Reference catalogs**

- User-owned instruments: refractometers with ATC and a personal WCF, hydrometers with a °Bx calibration offset and calibration temperature (T_cal). All hydrometer quantities are in °Bx — the scale the instruments actually show.
- One-shot calibration pair (refractometer + hydrometer, both readings in °Bx) computes a personal WCF applied to later readings of that refractometer.
- Yeast strains: producer, optimal temperature range, alcohol tolerance.
- A short first-instrument hint explains why must temperature and the calibration pair matter.

**Measurements and correction**

- Density, temperature and pH measurements with a full correction trace stored next to every measurement: raw reading → instrument → corrections → canonical value in SG, shown in both units.
- Hydrometer temperature correction to T_cal with honest warnings outside the 10–35 °C approximation zone; calibration offset applied additively in the Brix scale.
- Refractometer correction during fermentation: the two-component Novotný model by default (true extract, ABV and apparent SG across the whole fermentation), with the Terrill cubic formula (raw readings, domain guard) and the linear Balling model as manual overrides.
- Honest messaging: warnings and informational notes are separated; a refractometer without a personal WCF says its reading is used without correction.
- Delete-only measurement lifecycle with double confirmation and a revision audit (snapshots survive deletion).

**Analytics**

- Current and final ABV (Novotný / Hall), apparent attenuation, residual sugar (Balling RE) — always computed from corrected values.
- Fermentation completion forecast presented as an honest date range derived from the density trend.

**Journal and chart**

- A unified batch timeline: measurements, technological operations (racking, transfer, sugar, acid, nutrient, fining, bottling) and status changes in one place, with full operation editing.
- A density chart showing corrected values (main line) against raw readings (dashed), with per-instrument markers; every point opens the measurement card.

**Your data**

- Per-batch export to a human-readable JSON file that reads without the app.
- Automatic database backups with rotation — on startup, on a schedule and before quitting.

**Platform**

- Fully local: no network, no accounts, no telemetry; every screen works offline.
- Light and dark themes, keyboard-first operation (tab hotkeys, quick measurement entry in three actions), WCAG AA text contrast, 100/125/150 % scaling.
- Cross-platform builds from CI: macOS (Apple Silicon + Intel zips), Windows (NSIS setup) and Linux (deb, tar.gz).

### Known limitations in 0.1.0

- macOS builds are not Developer-ID signed: Gatekeeper shows a warning on first launch (right-click → Open, or allow in System Settings → Privacy & Security).
- The completion forecast is a linear estimate over the accumulated density trend; the target density is fixed at "dry" (0.999 SG).

[0.2.0]: https://github.com/shamanis/winemaker/releases/tag/v0.2.0
[0.1.0]: https://github.com/shamanis/winemaker/releases/tag/v0.1.0

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, type Rectangle } from 'electron'
import { createDatabase, type DatabaseHandle } from './db/database'
import { applyMigrations } from './db/migrate'
import { BackupScheduler, backupNow, rotateBackups } from './db/backup'
import { AppStateRepository } from './app-state/repository'
import { InstrumentRepository, YeastStrainRepository } from './catalogs/repositories'
import { BatchRepository } from './batches/repository'
import { MeasurementRepository } from './measurements/repository'
import { createResolveContextProvider } from './measurements/context'
import { OperationRepository } from './journal/repository'
import { registerIpcHandlers } from './ipc/register'
import {
  spawnUtilityUtility,
  utilityModulePath,
  type UtilityHandle
} from './utility/spawn'
import { emitEvent } from './events/emit'
import { nowUtcIso } from '../shared/time/utc'

// Изолированный профиль для dev-тестов: WINEMAKER_DATA_DIR=/tmp/... —
// ставится ДО requestSingleInstanceLock (лок привязан к userData), чтобы
// тестовый экземпляр работал параллельно с экземпляром пользователя
// и не смешивал данные.
const dataDirOverride = process.env.WINEMAKER_DATA_DIR
if (dataDirOverride) {
  app.setPath('userData', dataDirOverride)
}

let mainWindow: BrowserWindow | null = null
let dbHandle: DatabaseHandle | null = null
let scheduler: BackupScheduler | null = null
let utility: UtilityHandle | null = null
let repo: AppStateRepository | null = null

const LOCK_ACQUIRED = app.requestSingleInstanceLock()

if (!LOCK_ACQUIRED) {
  // SingleInstance: второй экземпляр не создаётся вовсе (desktop-platform).
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(main)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  // Крестик закрывает приложение целиком на всех платформах — ожидание
  // пользователя для личной утилиты (стандарт macOS «висеть в доке» здесь мешает).
  app.quit()
})

// Асинхронная очистка: бэкап «грязной» БД, закрытие процессов, закрытие БД.
let cleanupDone = false
app.on('will-quit', (event) => {
  if (cleanupDone) return
  event.preventDefault()
  void (async () => {
    await scheduler?.stop()
    utility?.kill()
    dbHandle?.sqlite.close()
    cleanupDone = true
    app.quit()
  })()
})

async function main(): Promise<void> {
  const dbPath = join(app.getPath('userData'), 'winemaker.db')
  const backupsDir = join(app.getPath('userData'), 'backups')

  // Стартовый бэкап существующей БД = защитная копия перед миграцией (design.md D5).
  const existed = existsSync(dbPath)
  dbHandle = createDatabase(dbPath)
  if (existed) {
    await backupNow(dbHandle.sqlite, backupsDir)
    await rotateBackups(backupsDir)
  }
  applyMigrations(dbHandle, migrationsFolder())

  scheduler = new BackupScheduler(dbHandle.sqlite, backupsDir, undefined, (path) => {
    emitEvent(BrowserWindow.getAllWindows(), 'backup:completed', {
      at: nowUtcIso(),
      path
    })
  })

  repo = new AppStateRepository(dbHandle.db, () => scheduler?.markDirty())

  const markDirty = (): void => scheduler?.markDirty()
  const instruments = new InstrumentRepository(dbHandle.db, markDirty)
  const strains = new YeastStrainRepository(dbHandle.db, markDirty)
  const batches = new BatchRepository(dbHandle.db, markDirty)
  const measurements = new MeasurementRepository(
    dbHandle.db,
    markDirty,
    createResolveContextProvider({ appState: repo, instruments, batches })
  )
  const operations = new OperationRepository(dbHandle.db, markDirty)

  utility = spawnUtilityUtility(utilityModulePath())

  registerIpcHandlers({
    appVersion: app.getVersion(),
    appState: repo,
    instruments,
    strains,
    batches,
    measurements,
    operations,
    utility: utility.rpc
  })

  createWindow()
  scheduler.start()
}

function migrationsFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
}

function createWindow(): void {
  const bounds = repo?.get<Rectangle>('windowBounds')
  // Иконка окна: важна для Windows/Linux; macOS берёт icns из бандла.
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')

  mainWindow = new BrowserWindow({
    icon: windowIcon,
    width: bounds?.width ?? 1024,
    height: bounds?.height ?? 720,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Winemaker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Сохранение состояния представления: размеры/позиция окна (ui-shell).
  let persistTimer: NodeJS.Timeout | null = null
  const persistBounds = (): void => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      if (mainWindow && !mainWindow.isDestroyed()) {
        repo?.set('windowBounds', mainWindow.getBounds())
      }
    }, 500)
    persistTimer.unref()
  }
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

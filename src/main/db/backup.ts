import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { nowUtcIso } from '../../shared/time/utc'

export const BACKUP_KEEP_COUNT = 5
export const DEFAULT_BACKUP_INTERVAL_MS = 5 * 60_000

const BACKUP_PREFIX = 'winemaker-backup-'
const BACKUP_SUFFIX = '.db'

function backupFileName(at: string): string {
  // Имя, безопасное для файловой системы и сортируемое по времени.
  const stamp = at.replace(/[:.]/g, '-')
  return `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`
}

/** Список файлов бэкапов каталога, отсортированный по времени (свежие в конце). */
export async function listBackupFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries
      .filter(
        (name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX)
      )
      .sort()
  } catch {
    return []
  }
}

/**
 * Чистая функция ротации: из списка файлов оставляет последние `keep`
 * (свежие по сортировке имён), остальные подлежат удалению.
 */
export function selectBackupsToDelete(files: string[], keep = BACKUP_KEEP_COUNT): string[] {
  if (files.length <= keep) return []
  return files.slice(0, files.length - keep)
}

/** Удаляет бэкапы сверх лимита. Возвращает число удалённых файлов. */
export async function rotateBackups(
  dir: string,
  keep = BACKUP_KEEP_COUNT
): Promise<number> {
  const files = await listBackupFiles(dir)
  const toDelete = selectBackupsToDelete(files, keep)
  await Promise.all(toDelete.map((name) => unlink(join(dir, name))))
  return toDelete.length
}

/** Создаёт копию файла БД (better-sqlite3 .backup — безопасно при открытом WAL). */
export async function backupNow(
  sqlite: Database.Database,
  backupsDir: string
): Promise<string> {
  await mkdir(backupsDir, { recursive: true })
  const target = join(backupsDir, backupFileName(nowUtcIso()))
  await sqlite.backup(target)
  return target
}

/**
 * Периодический автобэкап: при старте, по интервалу при наличии изменений
 * и при корректном выходе (design.md D5). Асинхронен, не блокирует вызовы.
 */
export class BackupScheduler {
  private dirty = false
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly sqlite: Database.Database,
    private readonly backupsDir: string,
    private readonly intervalMs: number = DEFAULT_BACKUP_INTERVAL_MS,
    private readonly onBackup?: (path: string) => void
  ) {}

  /** Отмечает наличие изменений с последнего бэкапа. */
  markDirty(): void {
    this.dirty = true
  }

  async runBackup(): Promise<string | null> {
    if (this.running) return null
    this.running = true
    try {
      const path = await backupNow(this.sqlite, this.backupsDir)
      this.dirty = false
      await rotateBackups(this.backupsDir)
      this.onBackup?.(path)
      return path
    } finally {
      this.running = false
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (this.dirty) void this.runBackup()
    }, this.intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.dirty) await this.runBackup()
  }
}

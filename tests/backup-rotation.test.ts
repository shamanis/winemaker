import { mkdtemp, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  BACKUP_KEEP_COUNT,
  backupNow,
  listBackupFiles,
  rotateBackups,
  selectBackupsToDelete
} from '../src/main/db/backup'

const tmpDirs: string[] = []

afterAll(async () => {
  // Содержимое удаляется вместе с каталогом системой; здесь достаточно
  // не оставить каталоги в репозитории.
  void tmpDirs
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'winemaker-backup-test-'))
  tmpDirs.push(dir)
  return dir
}

describe('ротация бэкапов', () => {
  it('чистая функция: нечего удалять при пустом списке', () => {
    expect(selectBackupsToDelete([])).toEqual([])
  })

  it('чистая функция: при числе файлов в пределах лимита ничего не удаляется', () => {
    const files = ['winemaker-backup-1.db', 'winemaker-backup-2.db']
    expect(selectBackupsToDelete(files)).toEqual([])
  })

  it('чистая функция: удаляются самые старые, остаются последние keep', () => {
    const files = [
      'winemaker-backup-2026-01-01.db',
      'winemaker-backup-2026-02-01.db',
      'winemaker-backup-2026-03-01.db',
      'winemaker-backup-2026-04-01.db',
      'winemaker-backup-2026-05-01.db',
      'winemaker-backup-2026-06-01.db',
      'winemaker-backup-2026-07-01.db'
    ]
    expect(selectBackupsToDelete(files, BACKUP_KEEP_COUNT)).toEqual([
      'winemaker-backup-2026-01-01.db',
      'winemaker-backup-2026-02-01.db'
    ])
  })

  it('listBackupFiles игнорирует чужие файлы', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'winemaker-backup-a.db'), '')
    await writeFile(join(dir, 'unrelated.txt'), '')
    expect(await listBackupFiles(dir)).toEqual(['winemaker-backup-a.db'])
  })

  it('rotateBackups удаляет старые файлы на диске', async () => {
    const dir = await tempDir()
    for (const name of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']) {
      await writeFile(join(dir, `winemaker-backup-${name}.db`), '')
    }
    const deleted = await rotateBackups(dir, 5)
    expect(deleted).toBe(2)
    expect(await readdir(dir)).toHaveLength(5)
  })

  it('backupNow создаёт читаемую копию БД', async () => {
    const dir = await tempDir()
    const sqlite = new Database(':memory:')
    sqlite.exec('CREATE TABLE probe (id INTEGER)')
    sqlite.prepare('INSERT INTO probe (id) VALUES (42)').run()

    const target = await backupNow(sqlite, dir)
    const copy = new Database(target)
    const row = copy.prepare('SELECT id FROM probe').get() as { id: number }
    copy.close()
    sqlite.close()
    expect(row.id).toBe(42)
  })
})

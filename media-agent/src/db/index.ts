import { Database } from 'bun:sqlite'
import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import { SCHEMA } from './schema.js'

export async function createDatabase(dbPath: string): Promise<Database> {
  await mkdir(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  ensurePostColumn(db, 'summary', 'TEXT')
  return db
}

export type { Database } from 'bun:sqlite'

function ensurePostColumn(db: Database, name: string, definition: string): void {
  const rows = db.query(`PRAGMA table_info(posts)`).all() as Array<{ name?: string }>
  const columns = new Set(rows.map((row) => String(row.name ?? '')))
  if (columns.has(name)) return
  db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`)
}

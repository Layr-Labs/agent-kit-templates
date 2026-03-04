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
  return db
}

export type { Database } from 'bun:sqlite'

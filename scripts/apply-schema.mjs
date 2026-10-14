import { readFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

const databaseUrls = [
  ['DATABASE_URL_UNPOOLED', process.env.DATABASE_URL_UNPOOLED],
  ['DATABASE_URL', process.env.DATABASE_URL],
].filter((entry) => Boolean(entry[1]))

if (databaseUrls.length === 0) {
  console.error('DATABASE_URL_UNPOOLED or DATABASE_URL is required.')
  process.exit(1)
}

const schemaUrl = new URL('../db/schema.sql', import.meta.url)
const schema = await readFile(schemaUrl, 'utf8')
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean)

let applied = false
let lastError

for (const [name, databaseUrl] of databaseUrls) {
  try {
    const sql = neon(databaseUrl)
    for (const statement of statements) {
      await sql.query(`${statement};`)
    }
    console.log(`Applied ${statements.length} schema statements using ${name}.`)
    applied = true
    break
  } catch (error) {
    lastError = error
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Schema apply with ${name} failed: ${message}`)
  }
}

if (!applied) {
  throw lastError
}

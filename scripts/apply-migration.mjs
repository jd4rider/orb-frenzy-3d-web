// Applies a .sql file to the Little Joy Arcade Postgres project through the Supabase
// Management API SQL endpoint. Authentication is the CLI access token (keychain), so this
// needs no database password - which is the only reason the db-password publish path
// was blocked.
import { readFileSync } from 'node:fs'

const REF = process.env.SUPABASE_PROJECT_REF || 'fqovramltegcfiyebyrt'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const file = process.argv[2]

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN is required'); process.exit(1) }
if (!file) { console.error('usage: node apply-migration.mjs <file.sql>'); process.exit(1) }

const sql = readFileSync(file, 'utf8')

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
})

const text = await res.text()
console.log(`HTTP ${res.status}`)
console.log(text)
process.exit(res.ok ? 0 : 1)

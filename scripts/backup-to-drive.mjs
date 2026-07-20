// Full-project disaster-recovery backup — zips the ENTIRE project (code +
// .env.local + every other gitignored file, excluding only node_modules/
// .next/.git/.vercel) and uploads it to a PRIVATE Drive folder. Deliberately
// does NOT go through git (secrets should never enter git history, even in
// a private repo — that history is effectively permanent). Deliberately
// does NOT grant "anyone with the link" access like the app's normal
// document uploads do — this stays visible only to the Drive account owner.
//
// Run manually: node scripts/backup-to-drive.mjs
import JSZip from 'jszip'
import { google } from 'googleapis'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { Readable } from 'stream'

const ROOT = process.cwd()
const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git', '.vercel'])

function walk(dir, zip, baseDir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, zip, baseDir)
    else zip.file(relative(baseDir, full), readFileSync(full))
  }
}

function loadEnv() {
  const text = readFileSync(join(ROOT, '.env.local'), 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

async function getOrCreateSubfolder(drive, parentId, name) {
  const list = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
  })
  const existing = list.data.files?.[0]
  if (existing?.id) return existing.id
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  })
  return created.data.id
}

async function main() {
  const env = loadEnv()
  console.log('Zipping project (this can take a minute for node_modules-free source + .env)...')
  const zip = new JSZip()
  walk(ROOT, zip, ROOT)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  console.log(`Zipped: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`)

  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN })
  const drive = google.drive({ version: 'v3', auth })

  const backupFolderId = await getOrCreateSubfolder(drive, env.GOOGLE_DRIVE_FOLDER_ID, 'Full Project Backups (PRIVATE - contains secrets)')

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `export-system-backup-${ts}.zip`

  await drive.files.create({
    requestBody: { name: fileName, parents: [backupFolderId] },
    media: { mimeType: 'application/zip', body: Readable.from(buffer) },
    fields: 'id',
  })
  // Deliberately NOT calling drive.permissions.create here — this file must
  // stay private to the Drive account owner only, unlike every other Drive
  // upload in this app which intentionally shares "anyone with the link".

  console.log(`Backup uploaded: ${fileName}`)
}

main().catch(e => { console.error('Backup failed:', e.message); process.exit(1) })

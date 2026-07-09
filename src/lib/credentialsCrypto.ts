// Reversible AES-256-GCM encryption for third-party portal passwords (Navis/
// SLPA/Trico) stored in automation_credentials — so the password isn't sitting
// in the database as plain text, but the app can still decrypt it server-side
// to actually log in later. Requires CREDENTIALS_ENC_KEY (32-byte, base64) in
// the environment; without it these two functions throw rather than silently
// storing plaintext.
import crypto from 'crypto'

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENC_KEY
  if (!raw) throw new Error('CREDENTIALS_ENC_KEY is not configured')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('CREDENTIALS_ENC_KEY must decode to 32 bytes')
  return key
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.')
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

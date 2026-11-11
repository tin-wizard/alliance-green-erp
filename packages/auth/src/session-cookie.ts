import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Cookie sealing for the app session.
 *
 * The cookie carries the Neon Auth session cookie and its current JWT, sealed
 * with AES-256-GCM under a key derived from SESSION_SECRET. It is not a
 * credential store: no password or password hash is ever placed here.
 */
export interface SealedSession {
  /** `name=value` Neon Auth session cookie, used only to refresh the JWT. */
  cookie: string
  /** Current JWT. Short-lived (15 minutes at the provider). */
  jwt: string
  /** App session expiry, epoch milliseconds. */
  expiresAt: number
}

const VERSION = 'v1'

function keyFor(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'cls-green-erp/session', 'aes-256-gcm', 32))
}

export function sealSession(secret: string, session: SealedSession): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv)
  cipher.setAAD(Buffer.from(VERSION))
  const plaintext = Buffer.from(JSON.stringify(session), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function unsealSession(secret: string, value: string | undefined): SealedSession | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null
  const [, ivPart, tagPart, ciphertextPart] = parts
  if (!ivPart || !tagPart || !ciphertextPart) return null

  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(ivPart, 'base64url'))
    decipher.setAAD(Buffer.from(VERSION))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ])
    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<SealedSession>
    if (
      typeof parsed.cookie !== 'string' ||
      typeof parsed.jwt !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null
    }
    return { cookie: parsed.cookie, jwt: parsed.jwt, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

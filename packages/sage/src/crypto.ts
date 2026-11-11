/**
 * Token custody. AES-256-GCM with a random IV per seal, AAD bound to the
 * environment and business so a ciphertext copied between connections fails to
 * decrypt. The database stores the sealed value plus a SHA-256 fingerprint;
 * nothing else touches the plaintext token.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'

export interface Sealer {
  seal(plaintext: string, aad: string): string
  open(sealed: string, aad: string): string
}

export function tokenFingerprint(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/** 32 bytes, base64 (43-44 chars with padding) or hex (64 chars). */
export function parseKey(raw: string): Buffer {
  const trimmed = raw.trim()
  const isHex = /^[0-9a-fA-F]{64}$/.test(trimmed)
  const key = isHex ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64')
  if (key.length !== 32) {
    throw new Error('SAGE_TOKEN_ENC_KEY must be 32 bytes encoded as base64 or 64 hex characters.')
  }
  return key
}

export function createSealer(rawKey: string): Sealer {
  const key = parseKey(rawKey)
  return {
    seal(plaintext, aad) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(aad, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return [VERSION, iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(
        '.',
      )
    },
    open(sealed, aad) {
      const [version, ivPart, bodyPart, tagPart] = sealed.split('.')
      if (version !== VERSION || !ivPart || !bodyPart || !tagPart) {
        throw new Error('Sealed token is not in the expected format.')
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'))
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(bodyPart, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}

export function connectionAad(environment: string, businessId: string | null): string {
  return `${environment}|${businessId ?? ''}`
}

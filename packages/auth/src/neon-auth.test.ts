import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose'
import { NeonAuthClient, NeonAuthError } from './neon-auth'

let server: Server
let origin: string
let privateKey: KeyLike
let wrongKey: KeyLike

async function issueToken(
  options: { sub?: string; email?: string; issuer?: string; expiresIn?: string | number } = {},
): Promise<string> {
  return new SignJWT({ email: options.email ?? 'tech@example.com', name: 'Tech' })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
    .setSubject(options.sub ?? 'neon-user-1')
    .setIssuer(options.issuer ?? origin)
    .setAudience(origin)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '15m')
    .sign(privateKey)
}

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA')
  privateKey = pair.privateKey
  wrongKey = (await generateKeyPair('EdDSA')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/jwks.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    if (url.pathname.endsWith('/sign-in/email')) {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      const mode = url.pathname.startsWith('/neondb/auth-body')
        ? 'body'
        : url.pathname.startsWith('/neondb/auth-opaque')
          ? 'opaque'
          : url.pathname.startsWith('/neondb/auth-invalid')
            ? 'invalid'
            : 'header'
      if (mode === 'invalid') {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }))
        return
      }
      void issueToken().then((jwt) => {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'set-cookie': `__Secure-neon-auth.session_token=session-abc; Path=/; HttpOnly; Secure; SameSite=None`,
        }
        if (mode === 'header') headers['set-auth-jwt'] = jwt
        response.writeHead(200, headers)
        response.end(
          JSON.stringify({
            ...(mode === 'opaque' ? { token: 'opaque-session-token' } : {}),
            user: { id: 'neon-user-1', email: 'tech@example.com', name: 'Tech', emailVerified: true },
          }),
        )
      })
      return
    }
    if (url.pathname.endsWith('/get-session')) {
      if (!request.headers.cookie?.includes('session-abc')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('null')
        return
      }
      void issueToken().then((jwt) => {
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-auth-jwt': jwt,
        })
        response.end(
          JSON.stringify({
            user: { id: 'neon-user-1', email: 'tech@example.com', name: 'Tech', emailVerified: true },
          }),
        )
      })
      return
    }
    response.writeHead(404).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function client(): NeonAuthClient {
  return new NeonAuthClient({
    baseUrl: `${origin}/neondb/auth`,
    jwksUrl: `${origin}/jwks.json`,
  })
}

describe('NeonAuthClient.verifyJwt', () => {
  it('accepts an EdDSA token with the expected issuer and audience', async () => {
    const claims = await client().verifyJwt(await issueToken())
    expect(claims.sub).toBe('neon-user-1')
    expect(claims.email).toBe('tech@example.com')
  })

  it('rejects an expired token', async () => {
    const token = await issueToken({ expiresIn: Math.floor(Date.now() / 1000) - 60 })
    await expect(client().verifyJwt(token)).rejects.toBeInstanceOf(NeonAuthError)
  })

  it('rejects the wrong issuer', async () => {
    const token = await issueToken({ issuer: 'https://evil.example' })
    await expect(client().verifyJwt(token)).rejects.toBeInstanceOf(NeonAuthError)
  })

  it('rejects a tampered token', async () => {
    const token = await issueToken()
    const parts = token.split('.')
    parts[2] = `${parts[2]?.slice(0, -2)}xx`
    await expect(client().verifyJwt(parts.join('.'))).rejects.toBeInstanceOf(NeonAuthError)
  })

  it('rejects a token signed by another key', async () => {
    const token = await new SignJWT({ email: 'tech@example.com' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setSubject('neon-user-1')
      .setIssuer(origin)
      .setAudience(origin)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(wrongKey)
    await expect(client().verifyJwt(token)).rejects.toBeInstanceOf(NeonAuthError)
  })
})

describe('NeonAuthClient.signIn', () => {
  it('returns the session cookie and verifies the JWT from the response header', async () => {
    const session = await client().signIn('tech@example.com', 'correct-password')
    expect(session.cookie).toBe('__Secure-neon-auth.session_token=session-abc')
    expect(session.claims.sub).toBe('neon-user-1')
    expect(session.user.email).toBe('tech@example.com')
  })

  it('falls back to /get-session when sign-in omits the JWT header', async () => {
    const session = await new NeonAuthClient({
      baseUrl: `${origin}/neondb/auth-body`,
      jwksUrl: `${origin}/jwks.json`,
    }).signIn('tech@example.com', 'correct-password')
    expect(session.jwt.split('.')).toHaveLength(3)
    expect(session.cookie).toContain('session-abc')
    expect(session.claims.sub).toBe('neon-user-1')
  })

  it('treats an opaque body token as a session token and refreshes', async () => {
    const session = await new NeonAuthClient({
      baseUrl: `${origin}/neondb/auth-opaque`,
      jwksUrl: `${origin}/jwks.json`,
    }).signIn('tech@example.com', 'correct-password')
    expect(session.jwt.split('.')).toHaveLength(3)
    expect(session.cookie).toContain('session-abc')
    expect(session.claims.sub).toBe('neon-user-1')
  })

  it('maps provider rejection to a 401 error without leaking details', async () => {
    // The test server rejects every sign-in under auth-invalid.
    const bad = new NeonAuthClient({
      baseUrl: `${origin}/neondb/auth-invalid`,
      jwksUrl: `${origin}/jwks.json`,
    })
    await expect(bad.signIn('tech@example.com', 'wrong')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password.',
    })
  })
})

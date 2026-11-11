/* eslint-disable no-console */
/**
 * Live Neon Auth proof. Creates no users and stores no credentials:
 *  - fetches the JWKS and reports the advertised key count;
 *  - attempts sign-in with a deliberately unknown address (expects 401);
 *  - mints a token with a random key and confirms the live JWKS rejects it.
 *
 * Run from the repo root:
 *   pnpm --filter @cls/auth smoke
 */
import { SignJWT, generateKeyPair } from 'jose'
import { getNeonAuth, NeonAuthError } from '../src/index'

async function main(): Promise<void> {
  const auth = getNeonAuth()
  console.log('health:', await auth.health())

  try {
    await auth.signIn('nobody@example.invalid', 'not-a-real-password')
    console.log('unknown sign-in: UNEXPECTED SUCCESS')
  } catch (error) {
    if (error instanceof NeonAuthError) {
      console.log('unknown sign-in:', { status: error.status, code: error.code, message: error.message })
    } else {
      throw error
    }
  }

  const { privateKey } = await generateKeyPair('EdDSA')
  const origin = new URL(process.env.NEON_AUTH_BASE_URL as string).origin
  const forged = await new SignJWT({ email: 'forged@example.com' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject('forged-user')
    .setIssuer(origin)
    .setAudience(origin)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  try {
    await auth.verifyJwt(forged)
    console.log('forged token rejected: false')
  } catch {
    console.log('forged token rejected: true')
  }
}

main().catch((error: unknown) => {
  console.error('auth smoke failed:', error)
  process.exitCode = 1
})

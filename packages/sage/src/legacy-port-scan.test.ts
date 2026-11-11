import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { SageNotConfiguredError, SageUnavailableError } from '@cls/core'
import { LegacyPortScanAdapter, probePort } from './legacy-port-scan'

const openServers: net.Server[] = []

async function listen(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => socket.end())
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No TCP address')
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function closedPort(): Promise<number> {
  const temporary = await listen()
  await temporary.close()
  return temporary.port
}

function adapter(
  ports: number[],
  overrides: Partial<ConstructorParameters<typeof LegacyPortScanAdapter>[0]> = {},
) {
  return new LegacyPortScanAdapter({
    enabled: true,
    host: '127.0.0.1',
    ports,
    database: 'simply',
    user: undefined,
    password: undefined,
    connectTimeoutMs: 300,
    ...overrides,
  })
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
})

describe('probePort', () => {
  it('detects a listening socket', async () => {
    const target = await listen()
    await expect(probePort('127.0.0.1', target.port, 300)).resolves.toBe(true)
  })

  it('returns false for a closed port instead of rejecting', async () => {
    const port = await closedPort()
    await expect(probePort('127.0.0.1', port, 300)).resolves.toBe(false)
  })
})

describe('LegacyPortScanAdapter', () => {
  it('scans in the configured order and returns the first listening port', async () => {
    const first = await listen()
    const second = await listen()
    const found = await adapter([first.port, second.port]).discover()
    expect(found).toEqual({ host: '127.0.0.1', port: first.port, verified: false })
  })

  it('skips closed ports and finds a later one', async () => {
    const target = await listen()
    const dead = await closedPort()
    const found = await adapter([dead, target.port]).discover()
    expect(found?.port).toBe(target.port)
  })

  it('returns null when no configured port is open', async () => {
    const deadA = await closedPort()
    const deadB = await closedPort()
    await expect(adapter([deadA, deadB]).discover()).resolves.toBeNull()
  })

  it('returns null without probing when disabled', async () => {
    const target = await listen()
    await expect(adapter([target.port], { enabled: false }).discover()).resolves.toBeNull()
  })

  it('reports disabled health without scanning', async () => {
    const health = await adapter([1], { enabled: false }).health()
    expect(health.status).toBe('disabled')
  })

  it('reports a TCP listener as unverified, never as a Sage company', async () => {
    const target = await listen()
    const health = await adapter([target.port]).health()
    expect(health.status).toBe('unverified')
    expect(health.endpoint).toEqual({ host: '127.0.0.1', port: target.port, verified: false })
  })

  it('reports unreachable when no port answers', async () => {
    const dead = await closedPort()
    const health = await adapter([dead]).health()
    expect(health.status).toBe('unreachable')
  })

  it('refuses to connect without credentials instead of faking a session', async () => {
    const target = await listen()
    await expect(adapter([target.port]).connect()).rejects.toBeInstanceOf(
      SageNotConfiguredError,
    )
  })

  it('refuses to connect when the sentinel company is absent', async () => {
    const dead = await closedPort()
    await expect(
      adapter([dead], { user: 'sageuser', password: 'not-used' }).connect(),
    ).rejects.toBeInstanceOf(SageUnavailableError)
  })
})

/*
 * Real MySQL integration. Set SAGE_TEST_MYSQL_PORT (and optionally user and
 * password) to run; skipped otherwise so `pnpm test` needs no database.
 */
const mysqlPort = Number.parseInt(process.env.SAGE_TEST_MYSQL_PORT ?? '', 10)
const mysqlWrongPort = Number.parseInt(process.env.SAGE_TEST_MYSQL_WRONG_PORT ?? '', 10)
const mysqlUser = process.env.SAGE_TEST_MYSQL_USER ?? 'sageuser'
const mysqlPassword = process.env.SAGE_TEST_MYSQL_PASSWORD ?? 'sagepass'

describe.skipIf(!Number.isInteger(mysqlPort))('LegacyPortScanAdapter (real MySQL)', () => {
  it('accepts the port whose company contains the SagePort sentinel', async () => {
    const instance = adapter([mysqlPort, mysqlPort], {
      user: mysqlUser,
      password: mysqlPassword,
    })
    const found = await instance.discover()
    expect(found).toEqual({ host: '127.0.0.1', port: mysqlPort, verified: true })
    await instance.disconnect()
  })

  it.skipIf(!Number.isInteger(mysqlWrongPort))(
    'rejects a MySQL port whose company lacks the sentinel and finds the right one',
    async () => {
      const instance = adapter([mysqlWrongPort, mysqlPort], {
        user: mysqlUser,
        password: mysqlPassword,
      })
      const found = await instance.discover()
      expect(found).toEqual({ host: '127.0.0.1', port: mysqlPort, verified: true })
      await instance.disconnect()
    },
  )

  it('does not accept a plain TCP listener that answers before the company', async () => {
    const decoy = await listen()
    const instance = adapter([decoy.port, mysqlPort], {
      user: mysqlUser,
      password: mysqlPassword,
    })
    const found = await instance.discover()
    expect(found).toEqual({ host: '127.0.0.1', port: mysqlPort, verified: true })
    await instance.disconnect()
  })

  it('reports verified health and opens a verified connection', async () => {
    const instance = adapter([mysqlPort], { user: mysqlUser, password: mysqlPassword })
    const health = await instance.health()
    expect(health.status).toBe('verified')

    const connection = await instance.connect()
    expect(connection.endpoint).toEqual({
      host: '127.0.0.1',
      port: mysqlPort,
      verified: true,
    })
    expect(connection.database).toBe('simply')
    expect(connection.serverVersion).toMatch(/^\d+\./)
    await instance.disconnect()
  })
})

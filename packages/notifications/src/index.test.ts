import { describe, expect, test } from 'vitest'
import {
  FileTransport,
  MAX_ATTEMPTS,
  MemoryTransport,
  nextAttemptDelay,
  RETRY_BACKOFF_MS,
} from './index'

describe('notification retry policy', () => {
  test('follows the ADR backoff and stops after five retries', () => {
    expect(nextAttemptDelay(1)).toBe(RETRY_BACKOFF_MS[0])
    expect(nextAttemptDelay(5)).toBe(RETRY_BACKOFF_MS[4])
    expect(nextAttemptDelay(MAX_ATTEMPTS)).toBe(RETRY_BACKOFF_MS[4])
    expect(nextAttemptDelay(MAX_ATTEMPTS + 1)).toBeNull()
  })
})

describe('notification transports', () => {
  test('memory keeps the rendered snapshot', async () => {
    const transport = new MemoryTransport()
    const result = await transport.send({
      to: 'tech@example.test',
      subject: 'Work order 42',
      text: 'Body',
      from: 'office@example.test',
    })
    expect(result.providerMessageId).toBe('memory-1')
    expect(transport.sent[0]?.subject).toBe('Work order 42')
  })

  test('file writes an eml and applies the override sink visibly', async () => {
    const writes: { path: string; contents: string }[] = []
    const transport = new FileTransport(
      {
        kind: 'file',
        from: 'office@example.test',
        overrideTo: 'sink@example.test',
        directory: 'var/mail',
      },
      async (path, contents) => {
        writes.push({ path, contents })
      },
    )
    await transport.send({
      to: 'tech@example.test',
      subject: 'Reminder',
      text: 'Body',
      from: 'office@example.test',
    })
    expect(writes[0]?.path.endsWith('.eml')).toBe(true)
    expect(writes[0]?.contents).toContain('To: sink@example.test')
    expect(writes[0]?.contents).toContain('intended for tech@example.test')
  })
})

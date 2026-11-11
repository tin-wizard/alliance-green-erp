import { describe, expect, test } from 'vitest'
import { decodeCursor, encodeCursor } from './cursor'

describe('keyset cursor', () => {
  test('round-trips a date cursor through a URL-safe string', () => {
    const cursor = { sort: 'newest' as const, value: '2026-11-11', id: 73850 }
    const encoded = encodeCursor(cursor)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(encoded)).toEqual(cursor)
  })

  test('round-trips a null sort value', () => {
    const cursor = { sort: 'expected' as const, value: null, id: 1 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  test('rejects malformed and unknown cursors rather than guessing', () => {
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor('not-base64!')).toBeNull()
    expect(decodeCursor(encodeCursor({ sort: 'newest', value: null, id: 1 }))).not.toBeNull()
    expect(
      decodeCursor(
        globalThis.btoa(JSON.stringify({ s: 'unsupported', v: null, i: 1 })),
      ),
    ).toBeNull()
    expect(
      decodeCursor(globalThis.btoa(JSON.stringify({ s: 'newest', v: null, i: '1' }))),
    ).toBeNull()
  })
})

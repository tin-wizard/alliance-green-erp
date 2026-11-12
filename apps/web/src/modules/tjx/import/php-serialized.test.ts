import { describe, expect, test } from 'vitest'
import { parsePhpSerialized, PhpSerializedError } from './php-serialized'

describe('parsePhpSerialized', () => {
  test('parses scalars', () => {
    expect(parsePhpSerialized('N;')).toBeNull()
    expect(parsePhpSerialized('b:1;')).toBe(true)
    expect(parsePhpSerialized('b:0;')).toBe(false)
    expect(parsePhpSerialized('i:-42;')).toBe(-42)
    expect(parsePhpSerialized('d:1.25;')).toBe(1.25)
    expect(parsePhpSerialized('s:5:"hello";')).toBe('hello')
  })

  test('parses lists and associative arrays', () => {
    expect(parsePhpSerialized('a:3:{i:0;s:1:"a";i:1;i:2;i:2;b:0;}')).toEqual(['a', 2, false])
    expect(parsePhpSerialized('a:2:{s:4:"name";s:3:"TJX";s:3:"qty";i:10;}')).toEqual({
      name: 'TJX',
      qty: 10,
    })
    expect(parsePhpSerialized('a:1:{i:0;a:1:{i:0;s:1:"x";}}')).toEqual([['x']])
  })

  test('rejects objects, unsupported types and trailing data', () => {
    expect(() => parsePhpSerialized('O:8:"stdClass":0:{}')).toThrow(PhpSerializedError)
    expect(() => parsePhpSerialized('i:1;x')).toThrow(/Trailing data/)
    expect(() => parsePhpSerialized('s:5:"no";')).toThrow(/Short string/)
  })
})

/**
 * Minimal PHP `serialize()` reader for TJX revision snapshots.
 * Supports arrays, strings, integers, doubles, booleans and null; rejects objects.
 */
export type PhpValue = string | number | boolean | null | PhpValue[] | { [key: string]: PhpValue }

export class PhpSerializedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhpSerializedError'
  }
}

class Reader {
  private index = 0
  constructor(private readonly text: string) {}

  parse(): PhpValue {
    const value = this.value()
    if (this.index !== this.text.length) {
      throw new PhpSerializedError(`Trailing data at ${this.index}.`)
    }
    return value
  }

  private expect(char: string): void {
    if (this.text[this.index] !== char) {
      throw new PhpSerializedError(`Expected "${char}" at ${this.index}.`)
    }
    this.index += 1
  }

  private value(): PhpValue {
    const type = this.text[this.index]
    this.index += 1
    switch (type) {
      case 'N':
        this.expect(';')
        return null
      case 'b': {
        this.expect(':')
        const digit = this.text[this.index]
        this.index += 1
        this.expect(';')
        if (digit === '1') return true
        if (digit === '0') return false
        throw new PhpSerializedError('Invalid boolean.')
      }
      case 'i': {
        this.expect(':')
        const end = this.text.indexOf(';', this.index)
        if (end < 0) throw new PhpSerializedError('Unterminated integer.')
        const raw = this.text.slice(this.index, end)
        if (!/^-?\d+$/.test(raw)) throw new PhpSerializedError('Invalid integer.')
        this.index = end + 1
        return Number(raw)
      }
      case 'd': {
        this.expect(':')
        const end = this.text.indexOf(';', this.index)
        if (end < 0) throw new PhpSerializedError('Unterminated double.')
        const raw = this.text.slice(this.index, end)
        if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
          throw new PhpSerializedError('Invalid double.')
        }
        this.index = end + 1
        return Number(raw)
      }
      case 's': {
        this.expect(':')
        const colon = this.text.indexOf(':', this.index)
        if (colon < 0) throw new PhpSerializedError('Invalid string length.')
        const length = Number(this.text.slice(this.index, colon))
        if (!Number.isInteger(length) || length < 0) {
          throw new PhpSerializedError('Invalid string length.')
        }
        this.index = colon + 1
        this.expect('"')
        const value = this.text.slice(this.index, this.index + length)
        if (value.length !== length) throw new PhpSerializedError('Short string.')
        this.index += length
        this.expect('"')
        this.expect(';')
        return value
      }
      case 'a': {
        this.expect(':')
        const colon = this.text.indexOf(':', this.index)
        if (colon < 0) throw new PhpSerializedError('Invalid array count.')
        const count = Number(this.text.slice(this.index, colon))
        if (!Number.isInteger(count) || count < 0) {
          throw new PhpSerializedError('Invalid array count.')
        }
        this.index = colon + 1
        this.expect('{')
        const entries: [PhpValue, PhpValue][] = []
        let list = true
        for (let position = 0; position < count; position += 1) {
          const key = this.value()
          const value = this.value()
          if (key !== position) list = false
          entries.push([key, value])
        }
        this.expect('}')
        if (list) return entries.map(([, value]) => value)
        const object: { [key: string]: PhpValue } = {}
        for (const [key, value] of entries) object[String(key)] = value
        return object
      }
      case 'O':
        throw new PhpSerializedError('Objects are not supported.')
      default:
        throw new PhpSerializedError(`Unsupported type "${type ?? 'EOF'}".`)
    }
  }
}

export function parsePhpSerialized(text: string): PhpValue {
  return new Reader(text).parse()
}

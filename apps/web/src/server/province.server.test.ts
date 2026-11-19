import { describe, expect, test, vi } from 'vitest'
import { logger } from '@cls/core/logger'
import { warnUnknownSalesProvince } from './province.server'

describe('warnUnknownSalesProvince', () => {
  test('warns once for a non-blank unknown code', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    warnUnknownSalesProvince('ZZ', 'invoice.preview')
    expect(warn).toHaveBeenCalledWith('Unknown sales province; using ON 13%', {
      province: 'ZZ',
      surface: 'invoice.preview',
    })
    warn.mockRestore()
  })

  test('stays quiet for blank and known codes', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    warnUnknownSalesProvince('', 'invoice.save')
    warnUnknownSalesProvince(null, 'invoice.save')
    warnUnknownSalesProvince('on', 'invoice.save')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

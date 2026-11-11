import { describe, expect, test } from 'vitest'
import { hasHandler } from '@cls/core/jobs'
import { registerRgaNotificationsJob } from './job.server'

describe('RGA notification job registration', () => {
  test('attaches the handler to the catalogue key exactly once', () => {
    registerRgaNotificationsJob()
    registerRgaNotificationsJob()
    expect(hasHandler('purchasing.rga-notifications')).toBe(true)
  })
})

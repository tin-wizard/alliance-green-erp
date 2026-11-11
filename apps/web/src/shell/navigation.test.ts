import { describe, expect, it } from 'vitest'
import { getNavigation } from './navigation'

describe('getNavigation', () => {
  it('always shows the dashboard', () => {
    const groups = getNavigation([])
    expect(groups[0]?.label).toBe('Overview')
    expect(groups[0]?.items[0]?.label).toBe('Dashboard')
  })

  it('hides admin entries without their permissions', () => {
    const groups = getNavigation(['workorder:read'])
    expect(groups.some((group) => group.label === 'Admin')).toBe(false)
  })

  it('shows only the admin entries the user can open', () => {
    const groups = getNavigation(['admin:audit'])
    const admin = groups.find((group) => group.label === 'Admin')
    expect(admin?.items.map((item) => item.label)).toEqual(['Audit log'])
  })

  it('never renders an empty group', () => {
    const groups = getNavigation(['admin:users'])
    for (const group of groups) expect(group.items.length).toBeGreaterThan(0)
  })

  it('puts Admin last', () => {
    const groups = getNavigation(['admin:users', 'admin:audit'])
    expect(groups.at(-1)?.label).toBe('Admin')
  })
})

import { describe, expect, it } from 'vitest'
import { PERMISSIONS, defaultGrantedPermissions } from '@cls/core'
import { evaluatePermissions, grantsInclude, grantsIncludeScoped } from './permissions'

describe('role matrix', () => {
  it('gives invoice.calculate to admins and to no other role', () => {
    expect(defaultGrantedPermissions('admin')).toContain('invoice.calculate')
    expect(defaultGrantedPermissions('technician')).not.toContain('invoice.calculate')
    expect(defaultGrantedPermissions('subcontractor')).not.toContain('invoice.calculate')
    expect(defaultGrantedPermissions('supplier')).not.toContain('invoice.calculate')
  })

  it('grants PO approval and issue to every admin (deliberate widening)', () => {
    for (const key of ['po.approve', 'po.issue']) {
      const definition = PERMISSIONS.find((permission) => permission.key === key)
      expect(definition, key).toBeDefined()
      expect(definition?.defaultRoles, key).toEqual(['admin'])
      expect(defaultGrantedPermissions('admin')).toContain(key)
      expect(defaultGrantedPermissions('technician')).not.toContain(key)
      expect(defaultGrantedPermissions('supplier')).not.toContain(key)
    }
  })

  it('reserves the module gates without granting them to a role', () => {
    const reserved = [
      'invoice.post_sage',
      'pma.certificate.download',
      'subcontractor.rates.download',
    ]
    for (const key of reserved) {
      const definition = PERMISSIONS.find((permission) => permission.key === key)
      expect(definition, key).toBeDefined()
      expect(definition?.defaultRoles, key).toEqual([])
    }
  })
})

describe('evaluatePermissions', () => {
  const now = new Date('2026-11-11T12:00:00Z')

  it('includes role defaults', () => {
    const grants = evaluatePermissions({
      role: 'technician',
      roleGrants: ['workorder:read', 'workorder:write'],
      userGrants: [],
      now,
    })
    expect(grants.map((grant) => grant.key)).toEqual(['workorder:read', 'workorder:write'])
  })

  it('adds an explicit user grant', () => {
    const grants = evaluatePermissions({
      role: 'technician',
      roleGrants: ['workorder:read'],
      userGrants: [
        {
          permissionKey: 'invoice:issue',
          isAllowed: true,
          expiresAt: null,
          scopeSubcontractorId: null,
        },
      ],
      now,
    })
    expect(grantsInclude(grants, 'invoice:issue')).toBe(true)
  })

  it('honours an explicit deny over a role default', () => {
    const grants = evaluatePermissions({
      role: 'admin',
      roleGrants: ['workorder:write', 'admin:users'],
      userGrants: [
        {
          permissionKey: 'admin:users',
          isAllowed: false,
          expiresAt: null,
          scopeSubcontractorId: null,
        },
      ],
      now,
    })
    expect(grantsInclude(grants, 'admin:users')).toBe(false)
    expect(grantsInclude(grants, 'workorder:write')).toBe(true)
  })

  it('ignores an expired grant and falls back to the role default', () => {
    const grants = evaluatePermissions({
      role: 'technician',
      roleGrants: ['workorder:read'],
      userGrants: [
        {
          permissionKey: 'invoice:issue',
          isAllowed: true,
          expiresAt: new Date('2026-11-10T12:00:00Z'),
          scopeSubcontractorId: null,
        },
      ],
      now,
    })
    expect(grantsInclude(grants, 'invoice:issue')).toBe(false)
  })

  it('ignores an expired deny, because the override no longer applies', () => {
    const grants = evaluatePermissions({
      role: 'admin',
      roleGrants: ['admin:users'],
      userGrants: [
        {
          permissionKey: 'admin:users',
          isAllowed: false,
          expiresAt: new Date('2026-11-01T00:00:00Z'),
          scopeSubcontractorId: null,
        },
      ],
      now,
    })
    expect(grantsInclude(grants, 'admin:users')).toBe(true)
  })

  it('keeps the WSIB override scoped to one subcontractor unless global', () => {
    const grants = evaluatePermissions({
      role: 'technician',
      roleGrants: [],
      userGrants: [
        {
          permissionKey: 'workorder:override_wsib_hold',
          isAllowed: true,
          expiresAt: null,
          scopeSubcontractorId: 42,
        },
      ],
      now,
    })
    expect(grantsIncludeScoped(grants, 'workorder:override_wsib_hold', 42)).toBe(true)
    expect(grantsIncludeScoped(grants, 'workorder:override_wsib_hold', 43)).toBe(false)

    const global = evaluatePermissions({
      role: 'admin',
      roleGrants: ['workorder:override_wsib_hold'],
      userGrants: [],
      now,
    })
    expect(grantsIncludeScoped(global, 'workorder:override_wsib_hold', 43)).toBe(true)
  })
})

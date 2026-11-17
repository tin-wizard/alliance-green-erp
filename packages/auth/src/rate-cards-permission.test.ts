import { describe, expect, it } from 'vitest'
import { PERMISSIONS, defaultGrantedPermissions } from '@cls/core'

describe('rate-card access', () => {
  it('is held by admin, the role the legacy rate screens served', () => {
    const definition = PERMISSIONS.find(
      (permission) => permission.key === 'report.download_rates',
    )
    expect(definition?.defaultRoles).toEqual(['admin'])
    expect(defaultGrantedPermissions('admin')).toContain('report.download_rates')
    expect(defaultGrantedPermissions('technician')).not.toContain('report.download_rates')
    expect(defaultGrantedPermissions('subcontractor')).not.toContain('report.download_rates')
    expect(defaultGrantedPermissions('supplier')).not.toContain('report.download_rates')
  })
})

/**
 * Server-function denial tests for the office modules.
 *
 * The session loader and the denial audit are the only runtime pieces replaced;
 * every assertion runs the real server function through its real middleware
 * chain. Every function that declares a permission key is listed here, so a
 * new unguarded export fails the list by inspection and a changed key fails the
 * 403 assertion when the caller holds the old one.
 */
import type { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, UnauthorizedError, type PermissionKey } from '@cls/core'
import type * as AuthModule from '@cls/auth'
import type { AuthSessionView } from './auth.types'

const current = vi.hoisted(() => ({ session: null as AuthSessionView | null }))

vi.mock('@cls/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>()
  return {
    ...actual,
    loadSessionFromRequest: async () => current.session,
    writeAudit: async () => undefined,
  }
})

import * as invoicing from '../modules/invoicing/server/invoicing.functions'
import * as admin from '../modules/admin/server/admin.functions'
import * as masterData from '../modules/master-data/server/master-data.functions'
import * as compliance from '../modules/compliance/server/compliance.functions'
import * as reports from '../modules/reports/server/reports.functions'
import * as messaging from '../modules/messaging/server/messaging.functions'

function session(role: AuthSessionView['user']['role'], grants: PermissionKey[]): AuthSessionView {
  return {
    id: 'session-denial-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: '00000000-0000-4000-8000-00000000de01',
      email: 'denial@example.test',
      username: 'denial',
      displayName: 'Denial Test',
      role,
      subcontractorId: null,
      grants: grants.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

type ServerFn = {
  __executeServer: (opts: { data?: unknown; context?: unknown }) => Promise<{
    result?: unknown
    error?: { status?: number; message?: string; name?: string }
  }>
}

const startStorageKey = Symbol.for('tanstack-start:start-storage-context')
const storage = (
  globalThis as unknown as { [key: symbol]: AsyncLocalStorage<unknown> | undefined }
)[startStorageKey]!

async function call(fn: ServerFn, data: unknown) {
  const context = {
    getRouter: async () => null,
    request: new Request('http://localhost/test'),
    startOptions: {},
    contextAfterGlobalMiddlewares: { session: current.session },
    handlerType: 'serverFn',
  }
  return storage.run(context, () => fn.__executeServer({ data, context: { session: current.session } }))
}

const guarded = (name: string, fn: unknown, key: string) => ({
  name,
  fn: fn as ServerFn,
  key,
})

const denied = [
  guarded('invoicing.listInvoicesFn', invoicing.listInvoicesFn, 'invoice:read'),
  guarded('invoicing.getInvoiceFn', invoicing.getInvoiceFn, 'invoice:read'),
  guarded('invoicing.findInvoiceForWorkOrderFn', invoicing.findInvoiceForWorkOrderFn, 'invoice:read'),
  guarded('invoicing.previewInvoiceFn', invoicing.previewInvoiceFn, 'invoice.calculate'),
  guarded('invoicing.regenerateInvoiceDocumentFn', invoicing.regenerateInvoiceDocumentFn, 'invoice:read'),
  guarded('invoicing.processSagePostingFn', invoicing.processSagePostingFn, 'invoice.post_sage'),
  guarded('invoicing.listSageOutboxFn', invoicing.listSageOutboxFn, 'invoice.post_sage'),
  guarded('invoicing.retrySagePostingFn', invoicing.retrySagePostingFn, 'invoice.post_sage'),
  guarded('invoicing.listSubcontractorInvoicesFn', invoicing.listSubcontractorInvoicesFn, 'invoice:read'),
  guarded('invoicing.getSubcontractorInvoiceFn', invoicing.getSubcontractorInvoiceFn, 'invoice:read'),
  guarded('admin.listAdminUsersFn', admin.listAdminUsersFn, 'admin:users'),
  guarded('admin.inviteUserFn', admin.inviteUserFn, 'admin:users'),
  guarded('admin.updateUserFn', admin.updateUserFn, 'admin:users'),
  guarded('admin.grantPermissionFn', admin.grantPermissionFn, 'admin:users'),
  guarded('admin.revokePermissionFn', admin.revokePermissionFn, 'admin:users'),
  guarded('admin.forcePasswordResetFn', admin.forcePasswordResetFn, 'admin:users'),
  guarded('admin.listSettingsFn', admin.listSettingsFn, 'admin:settings'),
  guarded('admin.saveSettingFn', admin.saveSettingFn, 'admin:settings'),
  guarded('admin.listAuditFn', admin.listAuditFn, 'admin:audit'),
  guarded('master-data.listCustomersFn', masterData.listCustomersFn, 'customer:read'),
  guarded('master-data.getCustomerFn', masterData.getCustomerFn, 'customer:read'),
  guarded('master-data.listSitesFn', masterData.listSitesFn, 'customer:read'),
  guarded('master-data.getSiteFn', masterData.getSiteFn, 'customer:read'),
  guarded('master-data.listSubcontractorsFn', masterData.listSubcontractorsFn, 'subcontractor:read'),
  guarded('master-data.getSubcontractorFn', masterData.getSubcontractorFn, 'subcontractor:read'),
  guarded('master-data.listSuppliersFn', masterData.listSuppliersFn, 'supplier:read'),
  guarded('master-data.getSupplierFn', masterData.getSupplierFn, 'supplier:read'),
  guarded('master-data.listPartsFn', masterData.listPartsFn, 'inventory:read'),
  guarded('master-data.getPartFn', masterData.getPartFn, 'inventory:read'),
  guarded('master-data.createCustomerFn', masterData.createCustomerFn, 'customer:write'),
  guarded('master-data.updateCustomerFn', masterData.updateCustomerFn, 'customer:write'),
  guarded('master-data.createSiteFn', masterData.createSiteFn, 'customer:write'),
  guarded('master-data.updateSiteFn', masterData.updateSiteFn, 'customer:write'),
  guarded('master-data.createSubcontractorFn', masterData.createSubcontractorFn, 'subcontractor:write'),
  guarded('master-data.updateSubcontractorFn', masterData.updateSubcontractorFn, 'subcontractor:write'),
  guarded('master-data.createSupplierFn', masterData.createSupplierFn, 'supplier:write'),
  guarded('master-data.updateSupplierFn', masterData.updateSupplierFn, 'supplier:write'),
  guarded('master-data.createPartFn', masterData.createPartFn, 'inventory:write'),
  guarded('master-data.updatePartFn', masterData.updatePartFn, 'inventory:write'),
  guarded('master-data.uploadSubcontractorDocumentFn', masterData.uploadSubcontractorDocumentFn, 'compliance:write'),
  guarded('master-data.getDocumentUrlFn', masterData.getDocumentUrlFn, 'compliance:read'),
  guarded('master-data.runComplianceRemindersFn', masterData.runComplianceRemindersFn, 'compliance:write'),
  guarded('master-data.runSageImportFn', masterData.runSageImportFn, 'customer:write'),
  guarded('compliance.getComplianceOverviewFn', compliance.getComplianceOverviewFn, 'compliance:read'),
  guarded('reports.runReportFn', reports.runReportFn, 'reports:read'),
  guarded('reports.exportReportFn', reports.exportReportFn, 'reports:read'),
  guarded('messaging.listThreadsFn', messaging.listThreadsFn, 'messages:read'),
  guarded('messaging.getThreadFn', messaging.getThreadFn, 'messages:read'),
  guarded('messaging.createThreadFn', messaging.createThreadFn, 'messages:write'),
  guarded('messaging.replyThreadFn', messaging.replyThreadFn, 'messages:write'),
  guarded('messaging.markThreadReadFn', messaging.markThreadReadFn, 'messages:read'),
  guarded('messaging.listMessageUsersFn', messaging.listMessageUsersFn, 'messages:read'),
  guarded('messaging.listNotificationsFn', messaging.listNotificationsFn, 'messages:read'),
  guarded('messaging.markNotificationReadFn', messaging.markNotificationReadFn, 'messages:read'),
  guarded('messaging.listOutboxFn', messaging.listOutboxFn, 'messages:admin'),
  guarded('messaging.retryNotificationFn', messaging.retryNotificationFn, 'messages:admin'),
]

const authenticated = [
  guarded('invoicing.createInvoiceFn', invoicing.createInvoiceFn, ''),
  guarded('invoicing.saveInvoiceFn', invoicing.saveInvoiceFn, ''),
  guarded('invoicing.issueInvoiceFn', invoicing.issueInvoiceFn, ''),
  guarded('invoicing.rejectInvoiceFn', invoicing.rejectInvoiceFn, ''),
  guarded('invoicing.resubmitInvoiceFn', invoicing.resubmitInvoiceFn, ''),
  guarded('invoicing.recordInvoicePaymentFn', invoicing.recordInvoicePaymentFn, ''),
  guarded('invoicing.submitSubcontractorInvoiceFn', invoicing.submitSubcontractorInvoiceFn, ''),
  guarded('invoicing.approveSubcontractorInvoiceFn', invoicing.approveSubcontractorInvoiceFn, ''),
  guarded('invoicing.rejectSubcontractorInvoiceFn', invoicing.rejectSubcontractorInvoiceFn, ''),
  guarded('invoicing.recordSubcontractorPaymentFn', invoicing.recordSubcontractorPaymentFn, ''),
  guarded('master-data.checkDuplicatesFn', masterData.checkDuplicatesFn, ''),
]

describe('guarded server functions', () => {
  it.each(denied)('$name rejects a caller without $key', async ({ fn, key }) => {
    current.session = session('technician', [])
    const result = await call(fn, {})
    expect(result.error).toBeInstanceOf(ForbiddenError)
    expect(result.error).toMatchObject({ status: 403 })
    expect(result.error?.message).toContain(key)
  })

  it.each([...denied, ...authenticated])('$name requires a session', async ({ fn }) => {
    current.session = null
    const result = await call(fn, {})
    expect(result.error).toBeInstanceOf(UnauthorizedError)
    expect(result.error).toMatchObject({ status: 401 })
  })
})

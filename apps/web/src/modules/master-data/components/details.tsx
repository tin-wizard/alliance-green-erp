import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, EmptyState, ErrorPanel, Field, Input, Select, Tag, formatDate, formatDateTime, formatMoney } from './ui'
import { DetailHeader } from './master-list'
import {
  getCustomerFn,
  getDocumentUrlFn,
  getPartFn,
  getSiteFn,
  getSubcontractorFn,
  getSupplierFn,
  uploadSubcontractorDocumentFn,
} from '../server/master-data.functions'

function Loading() {
  return <div className="py-16 text-center text-[13px] text-fg-muted">Loading…</div>
}

function Failure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorPanel message={error instanceof Error ? error.message : String(error)} retry={retry} />
  )
}

function NotFound({ what }: { what: string }) {
  return (
    <EmptyState
      title={`${what} not found`}
      description="Master Data keeps legacy ids stable. If the record was never imported, it stays missing rather than receiving a new number."
    />
  )
}

function Identity({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return <Field label={label} value={children} className={className} />
}

function SageState({ id, sageId }: { id: number; sageId: number | null }) {
  if (id < 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Tag tone="warning">Local — not in Sage</Tag>
        <p className="text-[11.5px] leading-relaxed text-fg-muted">
          Sage posting is blocked until the Sage import links this record. Its negative id is permanent
          and will not be renumbered.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Tag tone="info">Sage linked</Tag>
      <p className="text-[11.5px] text-fg-muted">Sage id {sageId ?? '—'}</p>
    </div>
  )
}

/* ------------------------------ customer ------------------------------ */

export function CustomerDetailScreen({ id, canWrite }: { id: number; canWrite?: boolean }) {
  const query = useQuery({
    queryKey: ['master-data', 'customer', id],
    queryFn: () => getCustomerFn({ data: { id } }),
  })
  if (query.isPending) return <Loading />
  if (query.error) return <Failure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <NotFound what="Customer" />

  const customer = query.data
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        eyebrow={`Master Data · Customer · ${customer.id < 0 ? 'local id' : 'Sage id'} ${customer.id}`}
        title={customer.name}
        description={`${customer.city ?? 'No city'}${customer.province ? `, ${customer.province}` : ''} · ${customer.sites.length} linked site${customer.sites.length === 1 ? '' : 's'}`}
        actions={
          <>
            {canWrite ? (
              <Link to="/master-data/customers/edit/$id" params={{ id: String(customer.id) }} className="text-[13px] text-brand hover:underline">
                Edit customer
              </Link>
            ) : null}
            <Link to="/master-data/customers" className="text-[13px] text-brand hover:underline">
              All customers
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Billing profile">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Street">{customer.street ?? '—'}</Identity>
            <Identity label="City / province">
              {customer.city ?? '—'}
              {customer.province ? `, ${customer.province}` : ''}
            </Identity>
            <Identity label="Postal code">{customer.postalCode ?? '—'}</Identity>
            <Identity label="Salesperson">{customer.salesperson ?? '—'}</Identity>
            <Identity label="Status">
              {customer.isActive ? <Tag tone="info">Active</Tag> : <Tag tone="warning">Inactive</Tag>}
            </Identity>
            <Identity label="Sage state"><SageState id={customer.id} sageId={customer.sageCustomerId} /></Identity>
          </dl>
        </Card>

        <Card title="Primary contact">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Name">{customer.contactName ?? '—'}</Identity>
            <Identity label="Phone">{customer.contactNumber ?? '—'}</Identity>
            <Identity label="Email">{customer.contactEmail ?? '—'}</Identity>
            <Identity label="Updated">{formatDateTime(customer.updatedAt)}</Identity>
          </dl>
        </Card>
      </div>

      <Card title="Sites" padded={false}>
        {customer.sites.length === 0 ? (
          <EmptyState
            title="No sites linked"
            description="A customer can exist before any service site is imported. Sites with a missing parent appear in the Sites list."
          />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Site</th>
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Street</th>
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">City</th>
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Province</th>
              </tr>
            </thead>
            <tbody>
              {customer.sites.map((site) => (
                <tr key={site.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-2.5">
                    <Link
                      to="/master-data/sites/$id"
                      params={{ id: String(site.id) }}
                      className="font-medium text-fg hover:text-brand hover:underline"
                    >
                      {site.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-fg-secondary">{site.street ?? '—'}</td>
                  <td className="px-4 py-2.5 text-fg-secondary">{site.city ?? '—'}</td>
                  <td className="px-4 py-2.5 text-fg-secondary">{site.province ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

/* -------------------------------- site -------------------------------- */

export function SiteDetailScreen({ id, canWrite }: { id: number; canWrite?: boolean }) {
  const query = useQuery({
    queryKey: ['master-data', 'site', id],
    queryFn: () => getSiteFn({ data: { id } }),
  })
  if (query.isPending) return <Loading />
  if (query.error) return <Failure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <NotFound what="Site" />

  const site = query.data
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        eyebrow={`Master Data · Site · ${site.id < 0 ? 'local id' : 'Sage id'} ${site.id}`}
        title={site.name}
        description={`${site.street ?? 'No street'} · ${site.city ?? 'No city'}${site.province ? `, ${site.province}` : ''}`}
        actions={
          <>
            {canWrite ? <Link to="/master-data/sites/edit/$id" params={{ id: String(site.id) }} className="text-[13px] text-brand hover:underline">Edit site</Link> : null}
            <Link to="/master-data/sites" className="text-[13px] text-brand hover:underline">All sites</Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Billing customer">
          {site.customerName ? (
            <div className="flex flex-col gap-2">
              <Link
                to="/master-data/customers/$id"
                params={{ id: String(site.customerId) }}
                className="text-[15px] font-medium text-fg hover:text-brand hover:underline"
              >
                {site.customerName}
              </Link>
              <p className="text-[12px] text-fg-muted">Sage customer id {site.customerId}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {site.customerId === null ? (
                <Tag tone="warning">No billing customer</Tag>
              ) : (
                <Tag tone="danger">Billing customer not imported (Sage id {site.customerId})</Tag>
              )}
              <p className="text-[12.5px] leading-relaxed text-fg-muted">
                The site is still available for work orders. Master Data shows the orphan rather than
                hiding it or inventing a parent.
              </p>
            </div>
          )}
        </Card>

        <Card title="Address">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Street">{site.street ?? '—'}</Identity>
            <Identity label="Street 2">{site.street2 ?? '—'}</Identity>
            <Identity label="City">{site.city ?? '—'}</Identity>
            <Identity label="Province / postal">
              {site.province ?? '—'} {site.postalCode ?? ''}
            </Identity>
            <Identity label="Site contact">{site.contactName ?? '—'}</Identity>
            <Identity label="Site phone">{site.contactNumber ?? '—'}</Identity>
            <Identity label="Sage state" className="sm:col-span-2"><SageState id={site.id} sageId={site.sageSiteId} /></Identity>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Warranty">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Under warranty">
              {site.warranty ? <Tag tone="info">Yes</Tag> : 'No'}
            </Identity>
            <Identity label="Expires">{formatDate(site.warrantyExpiresOn)}</Identity>
            <Identity label="Notes" className="sm:col-span-2">
              {site.warrantyNotes ?? '—'}
            </Identity>
          </dl>
        </Card>

        <Card title="Access notes">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="DNS">{site.dns ?? '—'}</Identity>
            <Identity label="Lift">{site.lift ?? '—'}</Identity>
            <Identity label="Mall">{site.mall ?? '—'}</Identity>
            <Identity label="Notes" className="sm:col-span-2">
              {site.notes ?? '—'}
            </Identity>
          </dl>
        </Card>
      </div>

      <Card title="Warranty records" padded={false}>
        {site.warranties.length === 0 ? (
          <EmptyState title="No warranty records" description="This site has no imported warranty documents." />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Description</th>
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Expires</th>
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Document</th>
              </tr>
            </thead>
            <tbody>
              {site.warranties.map((warranty) => (
                <tr key={warranty.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-2.5">{warranty.description ?? '—'}</td>
                  <td className="px-4 py-2.5">{formatDate(warranty.expiresOn)}</td>
                  <td className="px-4 py-2.5 text-fg-muted">{warranty.documentKey ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

/* ---------------------------- subcontractor ---------------------------- */

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function ComplianceDocuments({
  subcontractorId,
  documents,
  canManage,
}: {
  subcontractorId: number
  documents: Array<{
    id: string
    kind: string
    documentType: string | null
    documentName: string | null
    fileName: string | null
    contentType: string | null
    checksumSha256: string | null
    expiresOn: string | null
    isExpired: boolean
    supersededAt: string | null
  }>
  canManage: boolean
}) {
  const client = useQueryClient()
  const [kind, setKind] = useState<'wsib' | 'insurance' | 'other'>('wsib')
  const [documentName, setDocumentName] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [replaces, setReplaces] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a PDF, JPEG or PNG file.')
      const contentType = file.type
      if (contentType !== 'application/pdf' && contentType !== 'image/jpeg' && contentType !== 'image/png') {
        throw new Error('Only PDF, JPEG or PNG files are accepted.')
      }
      return uploadSubcontractorDocumentFn({
        data: {
          subcontractorId,
          kind,
          documentType: kind === 'other' ? 'Other' : kind.toUpperCase(),
          documentName: documentName || file.name,
          expiresOn: expiresOn || null,
          replacesDocumentId: replaces || null,
          fileName: file.name,
          contentType,
          data: await readFileBase64(file),
        },
      })
    },
    onSuccess: () => {
      setFile(null)
      setDocumentName('')
      setExpiresOn('')
      setReplaces('')
      void client.invalidateQueries({ queryKey: ['master-data', 'subcontractor', subcontractorId] })
    },
  })
  const view = useMutation({
    mutationFn: (id: string) => getDocumentUrlFn({ data: { id } }),
    onSuccess: (result) => {
      if (result?.url) window.open(result.url, '_blank', 'noopener,noreferrer')
    },
  })
  const current = documents.filter((document) => !document.supersededAt)
  const history = documents.filter((document) => document.supersededAt)
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <form
          className="grid gap-3 rounded-[4px] border border-hair bg-[var(--surface-subtle)] p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            upload.mutate()
          }}
        >
          <label className="text-[11.5px] text-fg-muted">Kind
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="wsib">WSIB</option>
              <option value="insurance">Insurance</option>
              <option value="other">Other</option>
            </Select>
          </label>
          <label className="text-[11.5px] text-fg-muted">Expiry {kind !== 'other' ? '(required)' : ''}
            <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required={kind !== 'other'} />
          </label>
          <label className="text-[11.5px] text-fg-muted">Document name
            <Input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="Certificate label" />
          </label>
          <label className="text-[11.5px] text-fg-muted">File (PDF, JPEG, PNG; max 10 MiB)
            <Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <label className="text-[11.5px] text-fg-muted">Replace current document
            <Select value={replaces} onChange={(e) => setReplaces(e.target.value)}>
              <option value="">No — add a new document</option>
              {current.map((document) => <option key={document.id} value={document.id}>{document.kind} · {document.documentName ?? document.fileName ?? document.id}</option>)}
            </Select>
          </label>
          <div className="flex items-end"><Button type="submit" variant="primary" size="sm" disabled={upload.isPending}>{upload.isPending ? 'Uploading…' : 'Upload document'}</Button></div>
          {upload.error ? <div className="sm:col-span-2"><ErrorPanel message={(upload.error as Error).message} /></div> : null}
        </form>
      ) : null}
      {documents.length === 0 ? (
        <EmptyState title="No compliance documents" description="A vendor with zero documents is not valid for assignment. Upload a WSIB or insurance certificate." />
      ) : (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-hair bg-[var(--surface-subtle)]">
              <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Type</th>
              <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Expires</th>
              <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">State</th>
              <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">File</th>
            </tr>
          </thead>
          <tbody>
            {[...current, ...history].map((document) => (
              <tr key={document.id} className="border-b border-hair last:border-0">
                <td className="px-4 py-2.5">{document.documentType ?? document.documentName ?? document.kind}</td>
                <td className="px-4 py-2.5">{formatDate(document.expiresOn)}</td>
                <td className="px-4 py-2.5">
                  {document.supersededAt ? <Tag tone="neutral">Superseded</Tag> : document.isExpired ? <Tag tone="danger">Expired</Tag> : <Tag tone="info">Current</Tag>}
                </td>
                <td className="px-4 py-2.5">
                  <Button size="sm" onClick={() => view.mutate(document.id)} disabled={view.isPending}>View {document.fileName ?? 'file'}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view.error ? <ErrorPanel message={(view.error as Error).message} /> : null}
    </div>
  )
}


export function SubcontractorDetailScreen({ id, canWrite, canManageCompliance }: { id: number; canWrite?: boolean; canManageCompliance?: boolean }) {
  const query = useQuery({
    queryKey: ['master-data', 'subcontractor', id],
    queryFn: () => getSubcontractorFn({ data: { id } }),
  })
  if (query.isPending) return <Loading />
  if (query.error) return <Failure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <NotFound what="Subcontractor" />

  const sub = query.data
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        eyebrow={`Master Data · Subcontractor · ${sub.id < 0 ? 'local id' : 'Sage id'} ${sub.id}`}
        title={sub.name}
        description={`${sub.city ?? 'No city'}${sub.province ? `, ${sub.province}` : ''}`}
        actions={
          <>
            {canWrite ? <Link to="/master-data/subcontractors/edit/$id" params={{ id: String(sub.id) }} className="text-[13px] text-brand hover:underline">Edit subcontractor</Link> : null}
            <Link to="/master-data/subcontractors" className="text-[13px] text-brand hover:underline">All subcontractors</Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Compliance">
          <div className="flex flex-col gap-3">
            {sub.wsibValid ? (
              <Tag tone="info">WSIB / insurance valid</Tag>
            ) : (
              <Tag tone="danger">Missing or expired</Tag>
            )}
            <p className="text-[12.5px] leading-relaxed text-fg-muted">
              Valid through {formatDate(sub.wsibExpirationDate)}. Zero documents is a failure, not a
              pass. Work Orders blocks assignment until a valid document exists.
            </p>
          </div>
        </Card>

        <Card title="Contact">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Contact">{sub.contactName ?? '—'}</Identity>
            <Identity label="Phone">{sub.contactNumber ?? '—'}</Identity>
            <Identity label="Email">{sub.contactEmail ?? '—'}</Identity>
            <Identity label="Alt emails">
              {[sub.email2, sub.email3].filter(Boolean).join(', ') || '—'}
            </Identity>
            <Identity label="Sage state" className="sm:col-span-2"><SageState id={sub.id} sageId={sub.sageSubcontractorId} /></Identity>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Address">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Street">{sub.street ?? '—'}</Identity>
            <Identity label="City">{sub.city ?? '—'}</Identity>
            <Identity label="Province / postal">
              {sub.province ?? '—'} {sub.postalCode ?? ''}
            </Identity>
            <Identity label="Status">
              {sub.isActive ? <Tag tone="info">Active</Tag> : <Tag tone="warning">Inactive</Tag>}
            </Identity>
          </dl>
        </Card>

        <Card title="Rates">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Identity label="Interior">{formatMoney(sub.rateInterior)}</Identity>
            <Identity label="Exterior">{formatMoney(sub.rateExterior)}</Identity>
            <Identity label="Other">{formatMoney(sub.rateOther)}</Identity>
          </dl>
          <p className="mt-3 text-[11.5px] text-fg-muted">
            Rates are read-only in Master Data. Downloading them is a separate reserved permission.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Documents" padded={false}>
          <div className="p-4">
            <ComplianceDocuments
              subcontractorId={sub.id}
              documents={sub.documents}
              canManage={Boolean(canManageCompliance)}
            />
          </div>
        </Card>

        <Card title="Additional contacts">
          {sub.contacts.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No additional contacts.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {sub.contacts.map((contact) => (
                <li key={contact.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="text-fg">{contact.contactName ?? 'Unnamed'}</span>
                  <span className="text-fg-muted">
                    {contact.phone ?? '—'}
                    {contact.phoneExt ? ` ext. ${contact.phoneExt}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------- supplier ------------------------------- */

export function SupplierDetailScreen({ id, canWrite }: { id: number; canWrite?: boolean }) {
  const query = useQuery({
    queryKey: ['master-data', 'supplier', id],
    queryFn: () => getSupplierFn({ data: { id } }),
  })
  if (query.isPending) return <Loading />
  if (query.error) return <Failure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <NotFound what="Supplier" />

  const supplier = query.data
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        eyebrow={`Master Data · Supplier · ${supplier.id < 0 ? 'local id' : 'Sage id'} ${supplier.id}`}
        title={supplier.name}
        description={`Sage vendor ${supplier.sageVendorId ?? '—'} · ${supplier.city ?? 'No city'}${supplier.province ? `, ${supplier.province}` : ''}`}
        actions={
          <>
            {canWrite ? <Link to="/master-data/suppliers/edit/$id" params={{ id: String(supplier.id) }} className="text-[13px] text-brand hover:underline">Edit supplier</Link> : null}
            <Link to="/master-data/suppliers" className="text-[13px] text-brand hover:underline">All suppliers</Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Address">{supplier.address ?? '—'}</Identity>
            <Identity label="City">{supplier.city ?? '—'}</Identity>
            <Identity label="Province / postal">
              {supplier.province ?? '—'} {supplier.postalCode ?? ''}
            </Identity>
            <Identity label="Status">
              {supplier.isActive ? <Tag tone="info">Active</Tag> : <Tag tone="warning">Inactive</Tag>}
            </Identity>
            <Identity label="Sage state" className="sm:col-span-2"><SageState id={supplier.id} sageId={supplier.sageVendorId} /></Identity>
          </dl>
        </Card>

        <Card title="Contacts">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Contact">{supplier.contactPerson ?? '—'}</Identity>
            <Identity label="Phone">{supplier.contactNumber ?? '—'}</Identity>
            <Identity label="Additional emails">{supplier.additionalEmails ?? '—'}</Identity>
            <Identity label="Accounting emails">{supplier.additionalEmailsAccounting ?? '—'}</Identity>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Purchasing flags">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Under CLS">{supplier.isUnderCls ? 'Yes' : 'No'}</Identity>
            <Identity label="Online vendor">{supplier.isOnlineVendor ? 'Yes' : 'No'}</Identity>
            <Identity label="PO approval">
              {supplier.bypassPoApproval ? <Tag tone="warning">Bypasses approval</Tag> : 'Standard'}
            </Identity>
            <Identity label="Updated">{formatDateTime(supplier.updatedAt)}</Identity>
          </dl>
        </Card>

        <Card title="PO notes">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-secondary">
            {supplier.poNotes || 'No PO notes.'}
          </p>
        </Card>
      </div>
    </div>
  )
}

/* --------------------------------- part --------------------------------- */

export function PartDetailScreen({ id, canWrite }: { id: number; canWrite?: boolean }) {
  const query = useQuery({
    queryKey: ['master-data', 'part', id],
    queryFn: () => getPartFn({ data: { id } }),
  })
  if (query.isPending) return <Loading />
  if (query.error) return <Failure error={query.error} retry={() => void query.refetch()} />
  if (!query.data) return <NotFound what="Part" />

  const part = query.data
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        eyebrow={`Master Data · Part · ${part.id < 0 ? 'local id' : 'Sage id'} ${part.id}`}
        title={part.partNumber}
        description={part.name ?? 'No description'}
        actions={
          <>
            {canWrite ? <Link to="/master-data/parts/edit/$id" params={{ id: String(part.id) }} className="text-[13px] text-brand hover:underline">Edit part</Link> : null}
            <Link to="/master-data/parts" className="text-[13px] text-brand hover:underline">Parts catalogue</Link>
          </>
        }
      />

      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-3 text-[12.5px] leading-relaxed text-fg-secondary">
        <span className="font-medium text-fg">Prices are read-only here.</span> Master Data has no
        price-write path. The only editor is the price-management screen, which holds the global
        lock. A held lock never hides a part or changes the committed price shown below.
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Identity">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Part number">{part.partNumber}</Identity>
            <Identity label="Group">{part.groupName ?? '—'}</Identity>
            <Identity label="Sage item id">{part.sageItemId ?? '—'}</Identity>
            <Identity label="Sage state"><SageState id={part.id} sageId={part.sageItemId} /></Identity>
            <Identity label="Sage status">
              {part.activeInSage ? <Tag tone="info">Active</Tag> : <Tag tone="warning">Inactive</Tag>}
            </Identity>
            <Identity label="Parent part">{part.parentPartNumber ?? '—'}</Identity>
            <Identity label="CLS linked code">{part.clsLinkedPartCode ?? '—'}</Identity>
            <Identity label="Subcontractor ignore">{part.subignore ? 'Yes' : 'No'}</Identity>
            <Identity label="Updated">{formatDateTime(part.updatedAt)}</Identity>
          </dl>
        </Card>

        <Card title="Committed prices">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Identity label="Sell price">{formatMoney(part.sellPrice)}</Identity>
            <Identity label="Cost">{formatMoney(part.cost)}</Identity>
            <Identity label="Install cost / unit">{formatMoney(part.installCostPerUnit)}</Identity>
            <Identity label="Install formula">{part.installProfitFormula ?? '—'}</Identity>
            <Identity label="Recycle formula">{part.recycleProfitFormula ?? '—'}</Identity>
            <Identity label="Warranty">
              {[part.warranty, part.labourWarranty].filter(Boolean).join(' / ') || '—'}
            </Identity>
          </dl>
        </Card>
      </div>

      <Card title="Supplier rate card" padded={false}>
        {part.supplierRates.length === 0 ? (
          <EmptyState title="No supplier rates" description="This part has no imported supplier rate card." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Supplier</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Cost</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Sell</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Markup</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Models</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Default</th>
                </tr>
              </thead>
              <tbody>
                {part.supplierRates.map((rate) => (
                  <tr key={rate.id} className="border-b border-hair last:border-0">
                    <td className="px-4 py-2.5">{rate.supplierName ?? rate.supplierId ?? '—'}</td>
                    <td className="px-4 py-2.5">{formatMoney(rate.costPrice)}</td>
                    <td className="px-4 py-2.5">{formatMoney(rate.sellPrice)}</td>
                    <td className="px-4 py-2.5">{rate.markup ?? '—'}</td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {[rate.modelNumber1, rate.modelNumber2, rate.modelNumber3].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5">{rate.defaultRate ? <Tag tone="info">Default</Tag> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Selling rates" padded={false}>
          {part.sellingRates.length === 0 ? (
            <EmptyState title="No selling rates" description="No dated selling-rate rows for this part." />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">List</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Sell</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Install</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Recycle</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Dated</th>
                </tr>
              </thead>
              <tbody>
                {part.sellingRates.map((rate) => (
                  <tr key={rate.id} className="border-b border-hair last:border-0">
                    <td className="px-4 py-2.5">{rate.listId ?? '—'}</td>
                    <td className="px-4 py-2.5">{formatMoney(rate.sellPrice)}</td>
                    <td className="px-4 py-2.5">{formatMoney(rate.installPrice)}</td>
                    <td className="px-4 py-2.5">{formatMoney(rate.recyclePrice)}</td>
                    <td className="px-4 py-2.5">{formatDateTime(rate.dateInserted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Price history" padded={false}>
          {part.priceHistory.length === 0 ? (
            <EmptyState title="No price history" description="No recorded changes for this part." />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">Field</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">From</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">To</th>
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">When</th>
                </tr>
              </thead>
              <tbody>
                {part.priceHistory.map((entry) => (
                  <tr key={entry.id} className="border-b border-hair last:border-0">
                    <td className="px-4 py-2.5">
                      {entry.fieldName}
                      {entry.sectionName ? <span className="text-fg-faint"> · {entry.sectionName}</span> : null}
                    </td>
                    <td className="px-4 py-2.5">{entry.lastValue ?? '—'}</td>
                    <td className="px-4 py-2.5">{entry.newValue ?? '—'}</td>
                    <td className="px-4 py-2.5">{formatDateTime(entry.changedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {part.notes ? (
        <Card title="Notes">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-secondary">{part.notes}</p>
        </Card>
      ) : null}
    </div>
  )
}

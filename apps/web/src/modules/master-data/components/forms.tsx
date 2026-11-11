import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, ErrorPanel, Input, Select, Tag, formatMoney } from './ui'
import { PageHeader } from '../../../shell/page-header'
import {
  createCustomerFn,
  createPartFn,
  createSiteFn,
  createSubcontractorFn,
  createSupplierFn,
  getCustomerFn,
  getPartFn,
  getSiteFn,
  getSubcontractorFn,
  getSupplierFn,
  listCustomersFn,
  updateCustomerFn,
  updatePartFn,
  updateSiteFn,
  updateSubcontractorFn,
  updateSupplierFn,
} from '../server/master-data.functions'
import type { CustomerDetail, PartDetail, SiteDetail, SubcontractorDetail, SupplierDetail } from '../types'

type Mode = 'create' | 'edit'

const PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY',
]

function Label({ label, children, required, hint }: { label: string; children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
        {label}{required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11.5px] text-fg-muted">{hint}</span> : null}
    </label>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-fg">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--action-primary-bg)]" />
      {label}
    </label>
  )
}

function FormActions({ mode, backTo, busy, error }: { mode: Mode; backTo: string; busy: boolean; error: unknown }) {
  return (
    <div className="flex flex-col gap-3 border-t border-hair pt-4">
      {error ? <ErrorPanel message={error instanceof Error ? error.message : String(error)} /> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}</Button>
        <Link to={backTo} className="text-[13px] text-fg-muted hover:text-fg">Cancel</Link>
      </div>
    </div>
  )
}

function Missing({ what }: { what: string }) {
  return (
    <div className="py-16 text-center">
      <p className="font-serif text-[22px] text-fg">{what} not found</p>
      <Link to=".." className="mt-2 inline-block text-[13px] text-brand hover:underline">Back to the list</Link>
    </div>
  )
}

/* ------------------------------ customer form ------------------------------ */

interface CustomerState {
  name: string; street: string; city: string; province: string; postalCode: string
  contactName: string; contactNumber: string; contactEmail: string; salesperson: string
  isActive: boolean; duplicateReason: string
}

function customerState(detail?: CustomerDetail): CustomerState {
  return {
    name: detail?.name ?? '', street: detail?.street ?? '', city: detail?.city ?? '',
    province: detail?.province ?? 'ON', postalCode: detail?.postalCode ?? '',
    contactName: detail?.contactName ?? '', contactNumber: detail?.contactNumber ?? '',
    contactEmail: detail?.contactEmail ?? '', salesperson: detail?.salesperson ?? '',
    isActive: detail?.isActive ?? true, duplicateReason: '',
  }
}

export function CustomerForm({ mode, id }: { mode: Mode; id?: number }) {
  const detail = useQuery({ queryKey: ['master-data', 'customer', id], queryFn: () => getCustomerFn({ data: { id: id! } }), enabled: mode === 'edit' })
  if (mode === 'edit') {
    if (detail.isPending) return <div className="py-16 text-center text-[13px] text-fg-muted">Loading…</div>
    if (detail.error) return <ErrorPanel message={(detail.error as Error).message} retry={() => void detail.refetch()} />
    if (!detail.data) return <Missing what="Customer" />
    return <CustomerFields key={detail.data.id} mode="edit" detail={detail.data} />
  }
  return <CustomerFields mode="create" />
}

function CustomerFields({ mode, detail }: { mode: Mode; detail?: CustomerDetail }) {
  const [form, setForm] = useState(() => customerState(detail))
  const [key] = useState(() => crypto.randomUUID())
  const navigate = useNavigate()
  const client = useQueryClient()
  const set = <K extends keyof CustomerState>(field: K, value: CustomerState[K]) => setForm((prev) => ({ ...prev, [field]: value }))
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name, street: form.street || null, city: form.city || null,
        province: form.province || null, postalCode: form.postalCode || null,
        contactName: form.contactName || null, contactNumber: form.contactNumber || null,
        contactEmail: form.contactEmail || null, salesperson: form.salesperson || null,
        isActive: form.isActive,
        duplicateOverride: form.duplicateReason.trim() ? { reason: form.duplicateReason } : null,
      }
      return mode === 'create'
        ? createCustomerFn({ data: { ...payload, idempotencyKey: key } })
        : updateCustomerFn({ data: { ...payload, id: detail!.id, updatedAt: detail!.updatedAt } })
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['master-data', 'customer', result.id] })
      void client.invalidateQueries({ queryKey: ['master-data', 'customers'] })
      void navigate({ to: '/master-data/customers/$id', params: { id: String(result.id) } })
    },
  })
  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
      <PageHeader eyebrow="Master Data · Customer" title={mode === 'create' ? 'New customer.' : 'Edit customer.'} description="A local record receives a negative id and is labelled not in Sage. It can be used immediately but cannot post to Sage until linked." />
      <Card title="Billing identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label label="Customer name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Label>
          <Label label="Salesperson"><Input value={form.salesperson} onChange={(e) => set('salesperson', e.target.value)} /></Label>
          <Label label="Street"><Input value={form.street} onChange={(e) => set('street', e.target.value)} /></Label>
          <Label label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Label>
          <Label label="Province"><Select value={form.province} onChange={(e) => set('province', e.target.value)}>{PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Label>
          <Label label="Postal code"><Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="M5V 1A1" /></Label>
          <Label label="Contact name"><Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></Label>
          <Label label="Contact phone"><Input value={form.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} /></Label>
          <Label label="Contact email"><Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Label>
          <div className="flex items-end pb-2"><Check label="Active" checked={form.isActive} onChange={(v) => set('isActive', v)} /></div>
        </div>
        <div className="mt-4 max-w-[520px]">
          <Label label="Duplicate override reason" hint="Only needed when the server flags a similar customer. Admins must give at least 10 characters.">
            <Input value={form.duplicateReason} onChange={(e) => set('duplicateReason', e.target.value)} />
          </Label>
        </div>
      </Card>
      <FormActions mode={mode} backTo="/master-data/customers" busy={mutation.isPending} error={mutation.error} />
    </form>
  )
}

/* -------------------------------- site form -------------------------------- */

interface SiteState {
  billingParent: 'existing' | 'orphan'; customerId: string; name: string; street: string; street2: string
  city: string; province: string; postalCode: string; contactName: string; contactNumber: string
  warranty: boolean; warrantyExpiresOn: string; warrantyNotes: string; notes: string
  dns: string; lift: string; mall: string; isActive: boolean; duplicateReason: string
}

function siteState(detail?: SiteDetail): SiteState {
  return {
    billingParent: detail?.customerId ? 'existing' : 'orphan',
    customerId: detail?.customerId ? String(detail.customerId) : '',
    name: detail?.name ?? '', street: detail?.street ?? '', street2: detail?.street2 ?? '',
    city: detail?.city ?? '', province: detail?.province ?? 'ON', postalCode: detail?.postalCode ?? '',
    contactName: detail?.contactName ?? '', contactNumber: detail?.contactNumber ?? '',
    warranty: detail?.warranty ?? false, warrantyExpiresOn: detail?.warrantyExpiresOn ?? '',
    warrantyNotes: detail?.warrantyNotes ?? '', notes: detail?.notes ?? '',
    dns: detail?.dns ?? '', lift: detail?.lift ?? '', mall: detail?.mall ?? '',
    isActive: detail?.isActive ?? true, duplicateReason: '',
  }
}

export function SiteForm({ mode, id }: { mode: Mode; id?: number }) {
  const detail = useQuery({ queryKey: ['master-data', 'site', id], queryFn: () => getSiteFn({ data: { id: id! } }), enabled: mode === 'edit' })
  if (mode === 'edit') {
    if (detail.isPending) return <div className="py-16 text-center text-[13px] text-fg-muted">Loading…</div>
    if (detail.error) return <ErrorPanel message={(detail.error as Error).message} retry={() => void detail.refetch()} />
    if (!detail.data) return <Missing what="Site" />
    return <SiteFields key={detail.data.id} mode="edit" detail={detail.data} />
  }
  return <SiteFields mode="create" />
}

function SiteFields({ mode, detail }: { mode: Mode; detail?: SiteDetail }) {
  const [form, setForm] = useState(() => siteState(detail))
  const [customerSearch, setCustomerSearch] = useState('')
  const [key] = useState(() => crypto.randomUUID())
  const customers = useQuery({
    queryKey: ['master-data', 'customer-options', customerSearch],
    queryFn: () => listCustomersFn({ data: { search: customerSearch || undefined, page: 1, pageSize: 50 } }),
    enabled: form.billingParent === 'existing',
  })
  const navigate = useNavigate()
  const client = useQueryClient()
  const set = <K extends keyof SiteState>(field: K, value: SiteState[K]) => setForm((prev) => ({ ...prev, [field]: value }))
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        billingParent: form.billingParent,
        customerId: form.billingParent === 'existing' && form.customerId ? Number(form.customerId) : null,
        name: form.name, street: form.street || null, street2: form.street2 || null,
        city: form.city || null, province: form.province || null, postalCode: form.postalCode || null,
        contactName: form.contactName || null, contactNumber: form.contactNumber || null,
        warranty: form.warranty, warrantyExpiresOn: form.warranty ? form.warrantyExpiresOn || null : null,
        warrantyNotes: form.warrantyNotes || null, notes: form.notes || null,
        dns: form.dns || null, lift: form.lift || null, mall: form.mall || null,
        isActive: form.isActive,
        duplicateOverride: form.duplicateReason.trim() ? { reason: form.duplicateReason } : null,
      }
      return mode === 'create'
        ? createSiteFn({ data: { ...payload, idempotencyKey: key } })
        : updateSiteFn({ data: { ...payload, id: detail!.id, updatedAt: detail!.updatedAt } })
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['master-data', 'site', result.id] })
      void client.invalidateQueries({ queryKey: ['master-data', 'sites'] })
      void navigate({ to: '/master-data/sites/$id', params: { id: String(result.id) } })
    },
  })
  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
      <PageHeader eyebrow="Master Data · Site" title={mode === 'create' ? 'New site.' : 'Edit site.'} description="Choose the billing parent explicitly. An orphan site is allowed; it stays visible and selectable for work orders." />
      <Card title="Billing customer">
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-[13px]"><input type="radio" checked={form.billingParent === 'existing'} onChange={() => set('billingParent', 'existing')} /> Existing customer</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="radio" checked={form.billingParent === 'orphan'} onChange={() => { set('billingParent', 'orphan'); set('customerId', '') }} /> Orphan site — no billing customer</label>
          {form.billingParent === 'existing' ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Label label="Search customers"><Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Name, city or contact" /></Label>
              <Label label="Billing customer" required>
                <Select value={form.customerId} onChange={(e) => set('customerId', e.target.value)} required>
                  <option value="">Choose a customer…</option>
                  {(customers.data?.rows ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.id < 0 ? ' (local)' : ''}</option>)}
                </Select>
              </Label>
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-muted">This site will show “No billing customer”. That is a deliberate state, not a missing required field.</p>
          )}
        </div>
      </Card>
      <Card title="Site address and access">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label label="Site name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Label>
          <Label label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Label>
          <Label label="Street"><Input value={form.street} onChange={(e) => set('street', e.target.value)} /></Label>
          <Label label="Street 2"><Input value={form.street2} onChange={(e) => set('street2', e.target.value)} /></Label>
          <Label label="Province"><Select value={form.province} onChange={(e) => set('province', e.target.value)}>{PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Label>
          <Label label="Postal code"><Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Label>
          <Label label="Site contact"><Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></Label>
          <Label label="Site phone"><Input value={form.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} /></Label>
          <Label label="DNS"><Input value={form.dns} onChange={(e) => set('dns', e.target.value)} /></Label>
          <Label label="Lift"><Input value={form.lift} onChange={(e) => set('lift', e.target.value)} /></Label>
          <Label label="Mall"><Input value={form.mall} onChange={(e) => set('mall', e.target.value)} /></Label>
          <div className="flex items-end pb-2"><Check label="Active" checked={form.isActive} onChange={(v) => set('isActive', v)} /></div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Check label="Under warranty" checked={form.warranty} onChange={(v) => set('warranty', v)} />{form.warranty ? <Label label="Warranty expires" required><Input type="date" value={form.warrantyExpiresOn} onChange={(e) => set('warrantyExpiresOn', e.target.value)} required /></Label> : null}</div>
          <Label label="Warranty notes"><Input value={form.warrantyNotes} onChange={(e) => set('warrantyNotes', e.target.value)} /></Label>
          <Label label="Site notes"><Input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Label>
          <Label label="Duplicate override reason" hint="Only needed when a similar site is flagged."><Input value={form.duplicateReason} onChange={(e) => set('duplicateReason', e.target.value)} /></Label>
        </div>
      </Card>
      <FormActions mode={mode} backTo="/master-data/sites" busy={mutation.isPending} error={mutation.error} />
    </form>
  )
}

/* --------------------------- subcontractor form --------------------------- */

interface ContactState { contactName: string; phone: string; phoneExt: string; email: string }

interface SubState {
  name: string; street: string; city: string; province: string; postalCode: string
  contactName: string; contactNumber: string; contactEmail: string; email2: string; email3: string
  rateInterior: string; rateExterior: string; rateOther: string
  isActive: boolean; contacts: ContactState[]; duplicateReason: string
}

function subState(detail?: SubcontractorDetail): SubState {
  return {
    name: detail?.name ?? '', street: detail?.street ?? '', city: detail?.city ?? '',
    province: detail?.province ?? 'ON', postalCode: detail?.postalCode ?? '',
    contactName: detail?.contactName ?? '', contactNumber: detail?.contactNumber ?? '',
    contactEmail: detail?.contactEmail ?? '', email2: detail?.email2 ?? '', email3: detail?.email3 ?? '',
    rateInterior: detail?.rateInterior ?? '', rateExterior: detail?.rateExterior ?? '', rateOther: detail?.rateOther ?? '',
    isActive: detail?.isActive ?? true,
    contacts: detail?.contacts.map((c) => ({ contactName: c.contactName ?? '', phone: c.phone ?? '', phoneExt: c.phoneExt ?? '', email: '' })) ?? [],
    duplicateReason: '',
  }
}

export function SubcontractorForm({ mode, id }: { mode: Mode; id?: number }) {
  const detail = useQuery({ queryKey: ['master-data', 'subcontractor', id], queryFn: () => getSubcontractorFn({ data: { id: id! } }), enabled: mode === 'edit' })
  if (mode === 'edit') {
    if (detail.isPending) return <div className="py-16 text-center text-[13px] text-fg-muted">Loading…</div>
    if (detail.error) return <ErrorPanel message={(detail.error as Error).message} retry={() => void detail.refetch()} />
    if (!detail.data) return <Missing what="Subcontractor" />
    return <SubcontractorFields key={detail.data.id} mode="edit" detail={detail.data} />
  }
  return <SubcontractorFields mode="create" />
}

function SubcontractorFields({ mode, detail }: { mode: Mode; detail?: SubcontractorDetail }) {
  const [form, setForm] = useState(() => subState(detail))
  const [key] = useState(() => crypto.randomUUID())
  const navigate = useNavigate()
  const client = useQueryClient()
  const set = <K extends keyof SubState>(field: K, value: SubState[K]) => setForm((prev) => ({ ...prev, [field]: value }))
  const setContact = (index: number, field: keyof ContactState, value: string) => setForm((prev) => ({ ...prev, contacts: prev.contacts.map((c, i) => i === index ? { ...c, [field]: value } : c) }))
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name, street: form.street || null, city: form.city || null,
        province: form.province || null, postalCode: form.postalCode || null,
        contactName: form.contactName || null, contactNumber: form.contactNumber || null,
        contactEmail: form.contactEmail || null, email2: form.email2 || null, email3: form.email3 || null,
        rateInterior: form.rateInterior || null, rateExterior: form.rateExterior || null, rateOther: form.rateOther || null,
        isActive: form.isActive,
        contacts: form.contacts.map((c) => ({ contactName: c.contactName || null, phone: c.phone || null, phoneExt: c.phoneExt || null, email: c.email || null })),
        duplicateOverride: form.duplicateReason.trim() ? { reason: form.duplicateReason } : null,
      }
      return mode === 'create'
        ? createSubcontractorFn({ data: { ...payload, idempotencyKey: key } })
        : updateSubcontractorFn({ data: { ...payload, id: detail!.id, updatedAt: detail!.updatedAt } })
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['master-data', 'subcontractor', result.id] })
      void client.invalidateQueries({ queryKey: ['master-data', 'subcontractors'] })
      void navigate({ to: '/master-data/subcontractors/$id', params: { id: String(result.id) } })
    },
  })
  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
      <PageHeader eyebrow="Master Data · Network" title={mode === 'create' ? 'New subcontractor.' : 'Edit subcontractor.'} description="Labour rates are editable here; parts prices are not. A local vendor has a negative id until Sage links it." />
      <Card title="Vendor profile">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label label="Name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Label>
          <Label label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Label>
          <Label label="Street"><Input value={form.street} onChange={(e) => set('street', e.target.value)} /></Label>
          <Label label="Province"><Select value={form.province} onChange={(e) => set('province', e.target.value)}>{PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Label>
          <Label label="Postal code"><Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Label>
          <Label label="Contact name"><Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></Label>
          <Label label="Phone"><Input value={form.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} /></Label>
          <Label label="Email"><Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Label>
          <Label label="Alt email 1"><Input type="email" value={form.email2} onChange={(e) => set('email2', e.target.value)} /></Label>
          <Label label="Alt email 2"><Input type="email" value={form.email3} onChange={(e) => set('email3', e.target.value)} /></Label>
          <Label label="Interior rate"><Input value={form.rateInterior} onChange={(e) => set('rateInterior', e.target.value)} placeholder="0.00" /></Label>
          <Label label="Exterior rate"><Input value={form.rateExterior} onChange={(e) => set('rateExterior', e.target.value)} placeholder="0.00" /></Label>
          <Label label="Other rate"><Input value={form.rateOther} onChange={(e) => set('rateOther', e.target.value)} placeholder="0.00" /></Label>
          <div className="flex items-end pb-2"><Check label="Active" checked={form.isActive} onChange={(v) => set('isActive', v)} /></div>
        </div>
        <div className="mt-4 max-w-[520px]"><Label label="Duplicate override reason"><Input value={form.duplicateReason} onChange={(e) => set('duplicateReason', e.target.value)} /></Label></div>
      </Card>
      <Card title="Additional contacts" action={<Button size="sm" onClick={() => set('contacts', [...form.contacts, { contactName: '', phone: '', phoneExt: '', email: '' }])}>Add contact</Button>}>
        {form.contacts.length === 0 ? <p className="text-[13px] text-fg-muted">No additional contacts.</p> : (
          <div className="flex flex-col gap-3">
            {form.contacts.map((contact, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-4">
                <Input value={contact.contactName} onChange={(e) => setContact(index, 'contactName', e.target.value)} placeholder="Name" />
                <Input value={contact.phone} onChange={(e) => setContact(index, 'phone', e.target.value)} placeholder="Phone" />
                <Input value={contact.phoneExt} onChange={(e) => setContact(index, 'phoneExt', e.target.value)} placeholder="Ext" />
                <div className="flex gap-2"><Input value={contact.email} onChange={(e) => setContact(index, 'email', e.target.value)} placeholder="Email" /><Button size="sm" onClick={() => set('contacts', form.contacts.filter((_, i) => i !== index))}>Remove</Button></div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <FormActions mode={mode} backTo="/master-data/subcontractors" busy={mutation.isPending} error={mutation.error} />
    </form>
  )
}

/* -------------------------------- supplier -------------------------------- */

interface SupplierState {
  name: string; address: string; city: string; province: string; postalCode: string
  contactPerson: string; contactNumber: string; additionalEmails: string; additionalEmailsAccounting: string
  isUnderCls: boolean; isOnlineVendor: boolean; bypassPoApproval: boolean; poNotes: string
  isActive: boolean; contacts: ContactState[]; duplicateReason: string
}

function supplierState(detail?: SupplierDetail): SupplierState {
  return {
    name: detail?.name ?? '', address: detail?.address ?? '', city: detail?.city ?? '',
    province: detail?.province ?? 'ON', postalCode: detail?.postalCode ?? '',
    contactPerson: detail?.contactPerson ?? '', contactNumber: detail?.contactNumber ?? '',
    additionalEmails: detail?.additionalEmails ?? '', additionalEmailsAccounting: detail?.additionalEmailsAccounting ?? '',
    isUnderCls: detail?.isUnderCls ?? false, isOnlineVendor: detail?.isOnlineVendor ?? false,
    bypassPoApproval: detail?.bypassPoApproval ?? false, poNotes: detail?.poNotes ?? '',
    isActive: detail?.isActive ?? true,
    contacts: detail?.contacts.map((c) => ({ contactName: c.contactName ?? '', phone: c.phone ?? '', phoneExt: c.phoneExt ?? '', email: c.email ?? '' })) ?? [],
    duplicateReason: '',
  }
}

export function SupplierForm({ mode, id }: { mode: Mode; id?: number }) {
  const detail = useQuery({ queryKey: ['master-data', 'supplier', id], queryFn: () => getSupplierFn({ data: { id: id! } }), enabled: mode === 'edit' })
  if (mode === 'edit') {
    if (detail.isPending) return <div className="py-16 text-center text-[13px] text-fg-muted">Loading…</div>
    if (detail.error) return <ErrorPanel message={(detail.error as Error).message} retry={() => void detail.refetch()} />
    if (!detail.data) return <Missing what="Supplier" />
    return <SupplierFields key={detail.data.id} mode="edit" detail={detail.data} />
  }
  return <SupplierFields mode="create" />
}

function SupplierFields({ mode, detail }: { mode: Mode; detail?: SupplierDetail }) {
  const [form, setForm] = useState(() => supplierState(detail))
  const [key] = useState(() => crypto.randomUUID())
  const navigate = useNavigate()
  const client = useQueryClient()
  const set = <K extends keyof SupplierState>(field: K, value: SupplierState[K]) => setForm((prev) => ({ ...prev, [field]: value }))
  const setContact = (index: number, field: keyof ContactState, value: string) => setForm((prev) => ({ ...prev, contacts: prev.contacts.map((c, i) => i === index ? { ...c, [field]: value } : c) }))
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name, address: form.address || null, city: form.city || null,
        province: form.province || null, postalCode: form.postalCode || null,
        contactPerson: form.contactPerson || null, contactNumber: form.contactNumber || null,
        additionalEmails: form.additionalEmails || null, additionalEmailsAccounting: form.additionalEmailsAccounting || null,
        isUnderCls: form.isUnderCls, isOnlineVendor: form.isOnlineVendor,
        bypassPoApproval: form.bypassPoApproval, poNotes: form.poNotes || null, isActive: form.isActive,
        contacts: form.contacts.map((c) => ({ contactName: c.contactName || null, phone: c.phone || null, phoneExt: c.phoneExt || null, email: c.email || null })),
        duplicateOverride: form.duplicateReason.trim() ? { reason: form.duplicateReason } : null,
      }
      return mode === 'create'
        ? createSupplierFn({ data: { ...payload, idempotencyKey: key } })
        : updateSupplierFn({ data: { ...payload, id: detail!.id, updatedAt: detail!.updatedAt } })
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['master-data', 'supplier', result.id] })
      void client.invalidateQueries({ queryKey: ['master-data', 'suppliers'] })
      void navigate({ to: '/master-data/suppliers/$id', params: { id: String(result.id) } })
    },
  })
  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
      <PageHeader eyebrow="Master Data · Network" title={mode === 'create' ? 'New supplier.' : 'Edit supplier.'} description="Supplier profiles and PO flags. Prices and rate cards are not editable here." />
      <Card title="Supplier profile">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label label="Name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Label>
          <Label label="City"><Input value={form.city} onChange={(e) => set('city', e.target.value)} /></Label>
          <Label label="Address"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Label>
          <Label label="Province"><Select value={form.province} onChange={(e) => set('province', e.target.value)}>{PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Label>
          <Label label="Postal code"><Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Label>
          <Label label="Contact person"><Input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></Label>
          <Label label="Phone"><Input value={form.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} /></Label>
          <Label label="Additional emails"><Input value={form.additionalEmails} onChange={(e) => set('additionalEmails', e.target.value)} /></Label>
          <Label label="Accounting emails"><Input value={form.additionalEmailsAccounting} onChange={(e) => set('additionalEmailsAccounting', e.target.value)} /></Label>
          <Label label="PO notes"><Input value={form.poNotes} onChange={(e) => set('poNotes', e.target.value)} /></Label>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Check label="Under CLS" checked={form.isUnderCls} onChange={(v) => set('isUnderCls', v)} />
          <Check label="Online vendor" checked={form.isOnlineVendor} onChange={(v) => set('isOnlineVendor', v)} />
          <Check label="Bypass PO approval" checked={form.bypassPoApproval} onChange={(v) => set('bypassPoApproval', v)} />
          <Check label="Active" checked={form.isActive} onChange={(v) => set('isActive', v)} />
        </div>
        <div className="mt-4 max-w-[520px]"><Label label="Duplicate override reason"><Input value={form.duplicateReason} onChange={(e) => set('duplicateReason', e.target.value)} /></Label></div>
      </Card>
      <Card title="Additional contacts" action={<Button size="sm" onClick={() => set('contacts', [...form.contacts, { contactName: '', phone: '', phoneExt: '', email: '' }])}>Add contact</Button>}>
        {form.contacts.length === 0 ? <p className="text-[13px] text-fg-muted">No additional contacts.</p> : (
          <div className="flex flex-col gap-3">
            {form.contacts.map((contact, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-4">
                <Input value={contact.contactName} onChange={(e) => setContact(index, 'contactName', e.target.value)} placeholder="Name" />
                <Input value={contact.phone} onChange={(e) => setContact(index, 'phone', e.target.value)} placeholder="Phone" />
                <Input value={contact.phoneExt} onChange={(e) => setContact(index, 'phoneExt', e.target.value)} placeholder="Ext" />
                <div className="flex gap-2"><Input value={contact.email} onChange={(e) => setContact(index, 'email', e.target.value)} placeholder="Email" /><Button size="sm" onClick={() => set('contacts', form.contacts.filter((_, i) => i !== index))}>Remove</Button></div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <FormActions mode={mode} backTo="/master-data/suppliers" busy={mutation.isPending} error={mutation.error} />
    </form>
  )
}

/* ---------------------------------- part ---------------------------------- */

interface PartState {
  partNumber: string; name: string; partGroupId: string; parentPartNumber: string
  clsLinkedPartCode: string; warranty: string; labourWarranty: string
  installProfitFormula: string; recycleProfitFormula: string; notes: string
  subignore: boolean; duplicateReason: string
}

function partState(detail?: PartDetail): PartState {
  return {
    partNumber: detail?.partNumber ?? '', name: detail?.name ?? '',
    partGroupId: detail?.partGroupId ? String(detail.partGroupId) : '',
    parentPartNumber: detail?.parentPartNumber ?? '', clsLinkedPartCode: detail?.clsLinkedPartCode ?? '',
    warranty: detail?.warranty ?? '', labourWarranty: detail?.labourWarranty ?? '',
    installProfitFormula: detail?.installProfitFormula ?? '', recycleProfitFormula: detail?.recycleProfitFormula ?? '',
    notes: detail?.notes ?? '', subignore: detail?.subignore ?? false, duplicateReason: '',
  }
}

export function PartForm({ mode, id }: { mode: Mode; id?: number }) {
  const detail = useQuery({ queryKey: ['master-data', 'part', id], queryFn: () => getPartFn({ data: { id: id! } }), enabled: mode === 'edit' })
  if (mode === 'edit') {
    if (detail.isPending) return <div className="py-16 text-center text-[13px] text-fg-muted">Loading…</div>
    if (detail.error) return <ErrorPanel message={(detail.error as Error).message} retry={() => void detail.refetch()} />
    if (!detail.data) return <Missing what="Part" />
    return <PartFields key={detail.data.id} mode="edit" detail={detail.data} />
  }
  return <PartFields mode="create" />
}

function PartFields({ mode, detail }: { mode: Mode; detail?: PartDetail }) {
  const [form, setForm] = useState(() => partState(detail))
  const [key] = useState(() => crypto.randomUUID())
  const navigate = useNavigate()
  const client = useQueryClient()
  const set = <K extends keyof PartState>(field: K, value: PartState[K]) => setForm((prev) => ({ ...prev, [field]: value }))
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        partNumber: form.partNumber, name: form.name || null,
        partGroupId: form.partGroupId ? Number(form.partGroupId) : null,
        parentPartNumber: form.parentPartNumber || null,
        clsLinkedPartCode: form.clsLinkedPartCode || null,
        warranty: form.warranty || null, labourWarranty: form.labourWarranty || null,
        installProfitFormula: form.installProfitFormula || null,
        recycleProfitFormula: form.recycleProfitFormula || null,
        notes: form.notes || null, subignore: form.subignore,
        duplicateOverride: form.duplicateReason.trim() ? { reason: form.duplicateReason } : null,
      }
      return mode === 'create'
        ? createPartFn({ data: { ...payload, idempotencyKey: key } })
        : updatePartFn({ data: { ...payload, id: detail!.id, updatedAt: detail!.updatedAt } })
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['master-data', 'part', result.id] })
      void client.invalidateQueries({ queryKey: ['master-data', 'parts'] })
      void navigate({ to: '/master-data/parts/$id', params: { id: String(result.id) } })
    },
  })
  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
      <PageHeader eyebrow="Master Data · Parts" title={mode === 'create' ? 'New part.' : 'Edit part.'} description="Identity and non-price attributes only. Cost, sell, install and recycle prices are rejected by the server." />
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-3 text-[12.5px] text-fg-secondary">
        <Tag tone="warning">No price fields</Tag>
        <span className="ml-2">This form cannot submit a price. The price-management screen owns every price write.</span>
      </div>
      <Card title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label label="Part number" required hint={mode === 'edit' ? 'Imported part numbers are immutable. Local parts can change until referenced.' : undefined}><Input value={form.partNumber} onChange={(e) => set('partNumber', e.target.value.toUpperCase())} required /></Label>
          <Label label="Description"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Label>
          <Label label="Part group id"><Input value={form.partGroupId} onChange={(e) => set('partGroupId', e.target.value)} inputMode="numeric" /></Label>
          <Label label="Parent part number"><Input value={form.parentPartNumber} onChange={(e) => set('parentPartNumber', e.target.value)} /></Label>
          <Label label="CLS linked code"><Input value={form.clsLinkedPartCode} onChange={(e) => set('clsLinkedPartCode', e.target.value)} /></Label>
          <div className="flex items-end pb-2"><Check label="Hide from subcontractor portal" checked={form.subignore} onChange={(v) => set('subignore', v)} /></div>
          <Label label="Warranty"><Input value={form.warranty} onChange={(e) => set('warranty', e.target.value)} /></Label>
          <Label label="Labour warranty"><Input value={form.labourWarranty} onChange={(e) => set('labourWarranty', e.target.value)} /></Label>
          <Label label="Install profit formula"><Input value={form.installProfitFormula} onChange={(e) => set('installProfitFormula', e.target.value)} /></Label>
          <Label label="Recycle profit formula"><Input value={form.recycleProfitFormula} onChange={(e) => set('recycleProfitFormula', e.target.value)} /></Label>
          <Label label="Notes"><Input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Label>
          <Label label="Duplicate override reason"><Input value={form.duplicateReason} onChange={(e) => set('duplicateReason', e.target.value)} /></Label>
        </div>
        {detail ? <p className="mt-4 text-[11.5px] text-fg-muted">Committed sell price: {formatMoney(detail.sellPrice)}. Read-only here.</p> : null}
      </Card>
      <FormActions mode={mode} backTo="/master-data/parts" busy={mutation.isPending} error={mutation.error} />
    </form>
  )
}

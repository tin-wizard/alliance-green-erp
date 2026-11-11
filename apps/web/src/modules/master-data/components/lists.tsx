import { useQuery } from '@tanstack/react-query'
import { Tag } from './ui'
import { formatMoney } from './ui'
import { MasterList, type MasterColumn } from './master-list'
import {
  listCustomersFn,
  listPartsFn,
  listSitesFn,
  listSubcontractorsFn,
  listSuppliersFn,
} from '../server/master-data.functions'
import type {
  CustomerListRow,
  PartListRow,
  SiteListRow,
  SubcontractorListRow,
  SupplierListRow,
} from '../types'

const PAGE_SIZE = 25

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* ------------------------------ customers ------------------------------ */

export function CustomerListScreen({
  search,
  page,
  onSearch,
  onPage,
}: {
  search: string
  page: number
  onSearch: (value: string) => void
  onPage: (page: number) => void
}) {
  const query = useQuery({
    queryKey: ['master-data', 'customers', search, page],
    queryFn: () => listCustomersFn({ data: { search: search || undefined, page, pageSize: PAGE_SIZE } }),
  })
  const columns: MasterColumn<CustomerListRow>[] = [
    { key: 'name', header: 'Customer', render: (row) => row.name },
    { key: 'city', header: 'City', render: (row) => row.city ?? '—' },
    { key: 'province', header: 'Province', render: (row) => row.province ?? '—' },
    { key: 'contact', header: 'Contact', render: (row) => row.contactName ?? '—' },
    { key: 'email', header: 'Email', render: (row) => row.contactEmail ?? '—' },
    {
      key: 'sites',
      header: 'Sites',
      render: (row) => row.siteCount.toLocaleString('en-CA'),
      className: 'text-right',
    },
  ]
  return (
    <MasterList
      eyebrow="Master Data · Supply"
      title="Customers."
      description="Billing accounts imported from Sage. Ids are Sage ids and never renumbered; sites can outlive a missing billing parent."
      search={search}
      searchPlaceholder="Search name, city, contact or email"
      onSearch={onSearch}
      rows={query.data?.rows}
      columns={columns}
      total={query.data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      loading={query.isPending}
      error={query.error ? errorText(query.error) : null}
      onRetry={() => void query.refetch()}
      onPage={onPage}
      rowKey={(row) => row.id}
      rowHref={(row) => `/master-data/customers/${row.id}`}
      emptyTitle="No customers match"
      emptyDescription="Clear the search, or check whether the Sage import has run. Master Data does not invent customer numbers."
    />
  )
}

/* -------------------------------- sites -------------------------------- */

export function SiteListScreen({
  search,
  page,
  parent,
  onSearch,
  onPage,
  onParent,
}: {
  search: string
  page: number
  parent: 'all' | 'present' | 'missing'
  onSearch: (value: string) => void
  onPage: (page: number) => void
  onParent: (value: 'all' | 'present' | 'missing') => void
}) {
  const query = useQuery({
    queryKey: ['master-data', 'sites', search, page, parent],
    queryFn: () =>
      listSitesFn({ data: { search: search || undefined, page, pageSize: PAGE_SIZE, parent } }),
  })
  const columns: MasterColumn<SiteListRow>[] = [
    { key: 'name', header: 'Site', render: (row) => row.name },
    {
      key: 'customer',
      header: 'Billing customer',
      render: (row) =>
        row.customerName ? (
          row.customerName
        ) : row.customerId === null ? (
          <Tag tone="warning">No billing customer</Tag>
        ) : (
          <Tag tone="danger">Billing customer not imported (Sage id {row.customerId})</Tag>
        ),
    },
    { key: 'address', header: 'Address', render: (row) => row.street ?? '—' },
    { key: 'city', header: 'City', render: (row) => row.city ?? '—' },
    { key: 'province', header: 'Province', render: (row) => row.province ?? '—' },
    {
      key: 'warranty',
      header: 'Warranty',
      render: (row) => (row.warranty ? <Tag tone="info">Yes</Tag> : '—'),
    },
  ]
  return (
    <MasterList
      eyebrow="Master Data · Supply"
      title="Sites."
      description="Service locations. A site is never hidden because its billing customer was not imported; orphaned rows are labelled and filterable."
      search={search}
      searchPlaceholder="Search site, address, city or customer"
      onSearch={onSearch}
      filter={
        <select
          aria-label="Billing parent"
          className="h-9 w-full rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-[13px] text-fg"
          value={parent}
          onChange={(event) =>
            onParent(event.target.value as 'all' | 'present' | 'missing')
          }
        >
          <option value="all">All sites</option>
          <option value="present">With billing customer</option>
          <option value="missing">Missing billing parent</option>
        </select>
      }
      rows={query.data?.rows}
      columns={columns}
      total={query.data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      loading={query.isPending}
      error={query.error ? errorText(query.error) : null}
      onRetry={() => void query.refetch()}
      onPage={onPage}
      rowKey={(row) => row.id}
      rowHref={(row) => `/master-data/sites/${row.id}`}
      emptyTitle="No sites match"
      emptyDescription="Clear the search or change the billing-parent filter. Sites are listed even when their customer is missing."
    />
  )
}

/* ---------------------------- subcontractors ---------------------------- */

export function SubcontractorListScreen({
  search,
  page,
  wsib,
  onSearch,
  onPage,
  onWsib,
}: {
  search: string
  page: number
  wsib: 'all' | 'valid' | 'missing'
  onSearch: (value: string) => void
  onPage: (page: number) => void
  onWsib: (value: 'all' | 'valid' | 'missing') => void
}) {
  const query = useQuery({
    queryKey: ['master-data', 'subcontractors', search, page, wsib],
    queryFn: () =>
      listSubcontractorsFn({ data: { search: search || undefined, page, pageSize: PAGE_SIZE, wsib } }),
  })
  const columns: MasterColumn<SubcontractorListRow>[] = [
    { key: 'name', header: 'Subcontractor', render: (row) => row.name },
    { key: 'city', header: 'City', render: (row) => row.city ?? '—' },
    { key: 'province', header: 'Province', render: (row) => row.province ?? '—' },
    { key: 'email', header: 'Email', render: (row) => row.contactEmail ?? '—' },
    {
      key: 'wsib',
      header: 'WSIB / insurance',
      render: (row) =>
        row.wsibValid ? (
          <Tag tone="info">Valid{row.wsibExpirationDate ? ` to ${row.wsibExpirationDate.slice(0, 10)}` : ''}</Tag>
        ) : (
          <Tag tone="danger">Missing or expired</Tag>
        ),
    },
    {
      key: 'active',
      header: 'Status',
      render: (row) => (row.isActive ? 'Active' : <Tag tone="warning">Inactive</Tag>),
    },
  ]
  return (
    <MasterList
      eyebrow="Master Data · Network"
      title="Subcontractors."
      description="Vendors available for assignment. Compliance is shown from the uploaded WSIB/insurance documents; no document means not valid, never an assumed pass."
      search={search}
      searchPlaceholder="Search name, city or email"
      onSearch={onSearch}
      filter={
        <select
          aria-label="Compliance"
          className="h-9 w-full rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-[13px] text-fg"
          value={wsib}
          onChange={(event) => onWsib(event.target.value as 'all' | 'valid' | 'missing')}
        >
          <option value="all">All compliance states</option>
          <option value="valid">Valid WSIB / insurance</option>
          <option value="missing">Missing or expired</option>
        </select>
      }
      rows={query.data?.rows}
      columns={columns}
      total={query.data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      loading={query.isPending}
      error={query.error ? errorText(query.error) : null}
      onRetry={() => void query.refetch()}
      onPage={onPage}
      rowKey={(row) => row.id}
      rowHref={(row) => `/master-data/subcontractors/${row.id}`}
      emptyTitle="No subcontractors match"
      emptyDescription="Clear the search or compliance filter. A vendor with zero documents appears under “Missing or expired”."
    />
  )
}

/* ------------------------------- suppliers ------------------------------- */

export function SupplierListScreen({
  search,
  page,
  onSearch,
  onPage,
}: {
  search: string
  page: number
  onSearch: (value: string) => void
  onPage: (page: number) => void
}) {
  const query = useQuery({
    queryKey: ['master-data', 'suppliers', search, page],
    queryFn: () => listSuppliersFn({ data: { search: search || undefined, page, pageSize: PAGE_SIZE } }),
  })
  const columns: MasterColumn<SupplierListRow>[] = [
    { key: 'name', header: 'Supplier', render: (row) => row.name },
    { key: 'sage', header: 'Sage vendor', render: (row) => row.sageVendorId ?? '—' },
    { key: 'city', header: 'City', render: (row) => row.city ?? '—' },
    { key: 'province', header: 'Province', render: (row) => row.province ?? '—' },
    {
      key: 'po',
      header: 'PO approval',
      render: (row) => (row.bypassPoApproval ? <Tag tone="warning">Bypasses</Tag> : 'Standard'),
    },
    {
      key: 'active',
      header: 'Status',
      render: (row) => (row.isActive ? 'Active' : <Tag tone="warning">Inactive</Tag>),
    },
  ]
  return (
    <MasterList
      eyebrow="Master Data · Network"
      title="Suppliers."
      description="Sage vendors and their purchasing flags. Prices and rate cards are read-only here; the price editor is the only write path."
      search={search}
      searchPlaceholder="Search name, city, contact or Sage id"
      onSearch={onSearch}
      rows={query.data?.rows}
      columns={columns}
      total={query.data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      loading={query.isPending}
      error={query.error ? errorText(query.error) : null}
      onRetry={() => void query.refetch()}
      onPage={onPage}
      rowKey={(row) => row.id}
      rowHref={(row) => `/master-data/suppliers/${row.id}`}
      emptyTitle="No suppliers match"
      emptyDescription="Clear the search. Supplier ids come from Sage and are never renumbered."
    />
  )
}

/* --------------------------------- parts --------------------------------- */

export function PartListScreen({
  search,
  page,
  onSearch,
  onPage,
}: {
  search: string
  page: number
  onSearch: (value: string) => void
  onPage: (page: number) => void
}) {
  const query = useQuery({
    queryKey: ['master-data', 'parts', search, page],
    queryFn: () => listPartsFn({ data: { search: search || undefined, page, pageSize: PAGE_SIZE } }),
  })
  const columns: MasterColumn<PartListRow>[] = [
    { key: 'partNumber', header: 'Part number', render: (row) => row.partNumber },
    { key: 'name', header: 'Description', render: (row) => row.name ?? '—' },
    { key: 'group', header: 'Group', render: (row) => row.groupName ?? '—' },
    { key: 'sell', header: 'Sell price', render: (row) => formatMoney(row.sellPrice), className: 'text-right' },
    {
      key: 'sage',
      header: 'Sage',
      render: (row) => (row.activeInSage ? 'Active' : <Tag tone="warning">Inactive</Tag>),
    },
  ]
  return (
    <MasterList
      eyebrow="Master Data · Supply"
      title="Parts catalogue."
      description="Parts and their committed selling prices. This screen is read-only: no field here writes cost or price, and holding the global lock changes nothing you see."
      search={search}
      searchPlaceholder="Search part number, description or group"
      onSearch={onSearch}
      rows={query.data?.rows}
      columns={columns}
      total={query.data?.total ?? 0}
      page={page}
      pageSize={PAGE_SIZE}
      loading={query.isPending}
      error={query.error ? errorText(query.error) : null}
      onRetry={() => void query.refetch()}
      onPage={onPage}
      rowKey={(row) => row.id}
      rowHref={(row) => `/master-data/parts/${row.id}`}
      emptyTitle="No parts match"
      emptyDescription="Clear the search. Parts arrive from the Sage catalogue; Master Data does not create part numbers."
    />
  )
}

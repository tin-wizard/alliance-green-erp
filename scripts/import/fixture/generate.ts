/* eslint-disable no-console */
/**
 * Generates the synthetic legacy dump the migration rehearsal loads.
 *
 * The fixture is a case matrix, not a scaled-down copy of production: it carries
 * one representative row per shape the cartographer documented (placeholder work
 * orders, orphan sites, duplicate usernames, money stored as text, zero dates,
 * latin1 accents, escapes and a hex literal) so a failure names a row rather than
 * a volume.
 *
 * Two files, both committed:
 *   fixtures/legacy/alliance_db_synthetic.sql   real mysqldump syntax, latin1 bytes
 *   fixtures/legacy/manifest.json               SHA-256, size, per-table row counts
 *
 * Determinism is a contract: the same Node version writes the same bytes every
 * run. Values come from a PRNG seeded with the table name, dates are literals,
 * and rows are emitted in primary-key order. `generate.test.ts` proves it.
 *
 * Usage:
 *   node --import tsx scripts/import/fixture/generate.ts
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import legacySchema from '../legacy-schema.json' with { type: 'json' }
import { ALL_TABLES, SKIPPED_DATED_DUPLICATES } from '../manifest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../..')

export const FIXTURE_DIR = join(repoRoot, 'fixtures/legacy')
export const FIXTURE_FILE = 'alliance_db_synthetic.sql'
export const MANIFEST_FILE = 'manifest.json'
export const DUMP_PATH = join(FIXTURE_DIR, FIXTURE_FILE)
export const MANIFEST_PATH = join(FIXTURE_DIR, MANIFEST_FILE)

/** Fixed on purpose: a moving clock would break the SHA-256 contract. */
export const GENERATED_AT = '2026-11-12T00:00:00.000Z'

interface LegacyColumn {
  name: string
  type: string
  notNull: boolean
}

interface LegacyTable {
  engine: string
  primaryKey: string[]
  columns: LegacyColumn[]
}

const legacy = legacySchema as unknown as { tables: Record<string, LegacyTable> }

/**
 * One value as the dump writes it: a quoted string, a bare literal (numbers),
 * a hex literal, or NULL. Keeping the distinction explicit is what lets the same
 * builder produce `'0.00'` and `0.00` on purpose.
 */
type Cell = string | { raw: string } | { hex: string } | null

type LegacyRow = Record<string, Cell>

export interface FixtureManifest {
  generatedAt: string
  source: 'synthetic'
  file: string
  sha256: string
  sizeBytes: number
  tables: { table: string; rows: number }[]
  nastyCases: { case: string; where: string }[]
}

export interface BuiltFixture {
  dump: string
  bytes: Buffer
  manifest: FixtureManifest
}

const raw = (value: string | number): Cell => ({ raw: String(value) })
const hex = (value: string): Cell => ({ hex: value })

// --- deterministic randomness ------------------------------------------------

/** FNV-1a over the table name: adding a table never shifts another table's rows. */
function seedFor(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32: small, fast, and identical on every platform. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(values: readonly T[], rng: () => number): T {
  const value = values[Math.floor(rng() * values.length) % values.length]
  if (value === undefined) throw new Error('cannot pick from an empty list')
  return value
}

/** Cyclic index into a non-empty list, never `undefined`. */
function at<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length]
  if (value === undefined) throw new Error('cannot index an empty list')
  return value
}

// --- shared value pools ------------------------------------------------------

const WORK_ORDER_IDS = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]
const CUSTOMER_IDS = [1, 2, 3, 4, 5, 6]
const SITE_IDS = [1, 2, 3, 4, 5, 6, 7, 8]
const USER_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const SUBCONTRACTOR_IDS = [1, 2, 3, 4, 5]
const SUPPLIER_IDS = [1, 2, 3, 4]
const PART_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const PART_NUMBERS = [
  'CLS-1001',
  'CLS-1002',
  'CLS-1003',
  'CLS-1004',
  'CLS-1005',
  'CLS-1006',
  'CLS-1007',
  'CLS-1008',
  'CLS-1009',
  'CLS-1010',
]
const PURCHASE_ORDER_IDS = [1, 2, 3, 4, 5, 6, 7, 8]
const CUSTOMER_QUOTE_IDS = [1, 2, 3, 4, 5]
const STANDALONE_QUOTE_IDS = [1, 2, 3]
const TJX_QUOTE_IDS = [1, 2, 3]
const RGA_IDS = [1, 2, 3, 4]
const PO_INVOICE_IDS = [1, 2, 3, 4]
const LOOKUP_STATUS_IDS = [1, 2, 3, 4]
const LOOKUP_PRIORITY_IDS = [1, 2, 3]
const PART_GROUP_IDS = [1, 2, 3]
const RATE_LIST_IDS = [1, 2]

/** Integer-typed columns that point at a parent table the fixture creates. */
const FOREIGN_KEY_COLUMNS: Record<string, number[]> = {
  woid: WORK_ORDER_IDS,
  woid_poid: WORK_ORDER_IDS,
  site: SITE_IDS,
  site_id: SITE_IDS,
  adj_site: SITE_IDS,
  custid: CUSTOMER_IDS,
  customer: SITE_IDS,
  customerid: CUSTOMER_IDS,
  from_customerid: CUSTOMER_IDS,
  subid: SUBCONTRACTOR_IDS,
  subcontractor: SUBCONTRACTOR_IDS,
  subcontractorid: SUBCONTRACTOR_IDS,
  from_subcontractorid: SUBCONTRACTOR_IDS,
  adj_subcontractor: SUBCONTRACTOR_IDS,
  supplier_id: SUPPLIER_IDS,
  sub_supplier_id: SUPPLIER_IDS,
  invoice_supplier_id: SUPPLIER_IDS,
  sage_vendor_id: SUPPLIER_IDS,
  poid: PURCHASE_ORDER_IDS,
  pre_poid: PURCHASE_ORDER_IDS,
  sup_poid: PURCHASE_ORDER_IDS,
  sup_qoid: PURCHASE_ORDER_IDS,
  transfer_came_from_poid: PURCHASE_ORDER_IDS,
  user_id: USER_IDS,
  createdby: USER_IDS,
  tech: USER_IDS,
  tech_2: USER_IDS,
  closeout_tech: USER_IDS,
  closeout_tech_2: USER_IDS,
  assigned_dispatch_id: USER_IDS,
  revised_by_user: USER_IDS,
  allowed_by: USER_IDS,
  approval_request_by: USER_IDS,
  part_group_id: PART_GROUP_IDS,
  part_id: PART_IDS,
  price_id: PART_IDS,
  invoice_id: PO_INVOICE_IDS,
  cust_qoid: CUSTOMER_QUOTE_IDS,
  sal_qoid: STANDALONE_QUOTE_IDS,
  quoteid: TJX_QUOTE_IDS,
  rgaid: RGA_IDS,
  status: LOOKUP_STATUS_IDS,
  status_id: LOOKUP_STATUS_IDS,
  previous_status_id: LOOKUP_STATUS_IDS,
  last_status: LOOKUP_STATUS_IDS,
  status_on_july_21_2025: LOOKUP_STATUS_IDS,
  priority: LOOKUP_PRIORITY_IDS,
  list_id: RATE_LIST_IDS,
  default_rate: [1, 2, 3],
  roomid: [1, 2, 3],
  fixtureid: [1, 2, 3],
  packing_slip_id: [1, 2],
  mass_adjustment_number: [1, 2, 3, 4],
  inventory_tracking_id: [1, 2, 3],
  po_part_id: [1, 2, 3],
  po_sopart_id: [1, 2],
  req_qoid: [1, 2],
}

const COMPANY_NAMES = [
  'Alliance Lighting Inc.',
  'CLS Green Systems',
  'Café Nord Éclairage',
  'Équipement Duval Ltée',
  'Hydro One Networks',
  'Cadillac Fairview',
  'RioCan Property Services',
  'Oxford Properties',
  'Tridel Corporation',
  'Menkes Developments',
]

const PERSON_NAMES = [
  'Marc Tremblay',
  'Sophie Dubé',
  'Jocelyn Roy',
  'Ana Ferreira',
  'Bill Okafor',
  'Luc Côté',
  'Priya Raman',
  'Derek Chan',
  'Hélène Girard',
  'Frank Zito',
]

const STREETS = [
  '12 King St W',
  '455 Front St E',
  '199 Bay St',
  '88 Queens Quay W',
  '3400 Rue Jean-Talon E',
  '750 Boulevard Industriel',
  '25 Sheppard Ave W',
  '100 Consilium Pl',
  '5650 Rue Hochelaga',
  '201 Portage Ave',
]

const CITIES = ['Toronto', 'Mississauga', 'Ottawa', 'Montréal', 'Sudbury', 'Laval', 'Winnipeg']
const PROVINCES = ['ON', 'QC', 'AB', 'BC', 'MB']
const POSTAL_CODES = ['M5H 2N2', 'M5A 1G1', 'H2R 2W3', 'K1P 1J1', 'P3C 5R4', 'L4W 1J7']
const PHONES = ['416-555-0110', '905-555-0142', '514-555-0198', '613-555-0177', '204-555-0123']
const EMAILS = [
  'dispatch@clsgreen.com',
  'accounting@clsgreen.com',
  'service@alliancelighting.ca',
  'ops@cafenord.ca',
  'billing@duval.qc.ca',
]
const PART_DESCRIPTIONS = [
  'Ballast 2-lamp T8 electronic',
  'Lamp LED T8 4ft 12W',
  'Exit sign LED emergency',
  'Emergency battery unit 90 min',
  'Lens diffuser 2x4',
  'Troffer door frame',
  'Occupancy sensor ceiling mount',
  'Fluorescent lamp F32T8',
  'Emergency light head',
  'Photocell 120V',
]
const NOTE_TEXTS = [
  'Replaced driver and verified output on all four fixtures.',
  'Vérifier le câblage et la boîte de jonction avant la prochaine visite.',
  'Customer approved the repair by email; completion photo attached.',
  'Commande reçue partielle, reste 2 unités en reliquat.',
  'Emergency circuit tested and tagged; report signed by site contact.',
  'Luminaire extérieur remplacé, façade ô côté cour.',
]
const MODEL_NUMBERS = ['MOD-4410', 'MOD-7781', 'MOD-2095', 'MOD-6622', 'MOD-1190']

/** Short vocabulary for varchar columns that no rule names explicitly. */
const SHORT_WORDS = [
  'Standard',
  'Interior',
  'Exterior',
  'Scheduled',
  'Alliance',
  'CLS',
  'Maintenance',
  'Completed',
  'Pending',
  'North',
]

// The legacy credential the fixture carries, computed rather than committed as a
// hash literal. It is a synthetic test account, never a real password.
const MD5_PASSWORD = createHash('md5').update('password', 'utf8').digest('hex')

// --- lookup labels -----------------------------------------------------------

/** Real labels: an unknown label is a migration error, so the fixture has none. */
const LOOKUP_LABELS: Record<string, string[]> = {
  wo_status: ['Open', 'In Progress', 'Complete', 'Cancelled', 'On Hold'],
  wo_priority: ['Low', 'Medium', 'High'],
  wo_servtype: ['Service Call', 'Project', 'Maintenance', 'Emergency'],
  wo_categories: ['Electrical', 'Lighting', 'Mechanical', 'Signage'],
  po_status: ['Draft', 'Submitted', 'Approved', 'Ordered', 'Received', 'Cancelled'],
  po_priority: ['Low', 'Medium', 'High'],
  po_preorder_status: ['New', 'Quoted', 'Converted'],
  customer_quote_status: ['Draft', 'Sent', 'Approved', 'Rejected'],
  standalone_quote_status: ['Draft', 'Sent', 'Approved', 'Rejected'],
  tjx_quote_status: ['Draft', 'Sent', 'Approved', 'Rejected'],
  rga_status: ['Requested', 'Shipped', 'Received', 'Closed'],
}

const LOOKUP_CODES: Record<string, string[]> = {
  wo_categories: ['ELEC', 'LIGHT', 'MECH', 'SIGN'],
}

// --- special rows ------------------------------------------------------------

/**
 * The rows that carry the documented nasty cases. Every other column on those
 * rows is filled from the same rules as the rest of the table, so a case is one
 * deliberate value, not a hand-built row.
 */
const SPECIAL_ROWS: Record<string, LegacyRow[]> = {
  users: [
    {
      id: raw(1),
      username: 'jsmith',
      password: MD5_PASSWORD,
      email: 'jsmith@clsgreen.com',
      access: raw(1),
      subid: raw(1),
      full_name: 'Jason Smith',
      is_enabled: raw(1),
      department_type: 'Office',
    },
    {
      // Same username as id 1: neither row can log in until an admin picks one.
      id: raw(2),
      username: 'jsmith',
      password: MD5_PASSWORD,
      email: 'j.smith@clsgreen.com',
      access: raw(1),
      subid: raw(1),
      full_name: 'J. Smith (dispatch)',
      is_enabled: raw(1),
      department_type: 'Office',
    },
    {
      id: raw(3),
      username: 'mchen',
      password: MD5_PASSWORD,
      email: 'mchen@clsgreen.com',
      access: raw(1),
      subid: raw(2),
      full_name: 'Mei Chen',
      is_enabled: raw(0),
      department_type: 'Accounting',
    },
    {
      id: raw(4),
      username: 'rpatel',
      password: MD5_PASSWORD,
      email: 'rpatel@clsgreen.com',
      access: raw(0),
      subid: raw(3),
      full_name: 'Raj Patel',
      is_enabled: raw(0),
      department_type: 'Technician',
    },
    {
      id: raw(5),
      username: 'tgarcia',
      password: MD5_PASSWORD,
      email: 'tgarcia@clsgreen.com',
      access: raw(0),
      subid: raw(4),
      full_name: 'Tomás García',
      is_enabled: raw(0),
      department_type: 'Technician',
    },
    {
      // subid points at a vendor row that does not exist.
      id: raw(6),
      username: 'dnguyen',
      password: MD5_PASSWORD,
      email: 'dnguyen@clsgreen.com',
      access: raw(0),
      subid: raw(99),
      full_name: 'Duc Nguyen',
      is_enabled: raw(1),
      department_type: 'Subcontractor',
    },
    {
      // Empty string, not NULL: the legacy form submits an empty field.
      id: raw(7),
      username: 'kwilliams',
      password: MD5_PASSWORD,
      email: '',
      access: raw(1),
      subid: raw(5),
      full_name: 'Kim Williams',
      is_enabled: raw(1),
      department_type: 'Office',
    },
    {
      id: raw(8),
      username: 'info',
      password: MD5_PASSWORD,
      email: 'info@clsgreen.com',
      access: raw(1),
      full_name: 'Shared Info Mailbox',
      is_enabled: raw(1),
      department_type: 'Office',
    },
    {
      // Second account on the shared company mailbox: cohort planner must pick.
      id: raw(9),
      username: 'accounting',
      password: MD5_PASSWORD,
      email: 'info@clsgreen.com',
      access: raw(1),
      full_name: 'Shared Accounting Mailbox',
      is_enabled: raw(1),
      department_type: 'Accounting',
    },
    {
      id: raw(10),
      username: 'lduval',
      password: MD5_PASSWORD,
      email: 'lduval@duval.qc.ca',
      access: raw(1),
      subid: raw(5),
      full_name: 'Luc Duval (électricien)',
      is_enabled: raw(1),
      department_type: 'Technician',
    },
    {
      id: raw(11),
      username: 'sjones',
      password: MD5_PASSWORD,
      email: 'sjones@clsgreen.com',
      access: raw(0),
      subid: raw(4),
      full_name: 'Sara Jones',
      is_enabled: raw(1),
      department_type: 'Technician',
    },
    {
      id: raw(12),
      username: 'acombes',
      password: MD5_PASSWORD,
      email: 'acombes@clsgreen.com',
      access: raw(1),
      full_name: 'André Combes',
      is_enabled: raw(1),
      department_type: 'Office',
    },
  ],
  customer: [
    {
      id: raw(1),
      name: 'Alliance Lighting Inc.',
      street: '12 King St W',
      city: 'Toronto',
      province: 'ON',
      postalcode: 'M5H 2N2',
      cname: 'Marc Tremblay',
      cnumber: '416-555-0110',
      cemail1: 'service@alliancelighting.ca',
      salesp: 'Derek Chan',
    },
    {
      id: raw(2),
      name: 'CLS Green Systems',
      street: '455 Front St E',
      city: 'Montréal',
      province: 'QC',
      postalcode: 'H2R 2W3',
      cname: 'Sophie Dubé',
      cnumber: '514-555-0198',
      cemail1: 'dispatch@clsgreen.com',
      salesp: 'Marc Tremblay',
    },
    {
      // Quote and accent in one text column: the tokenizer has to unescape both.
      id: raw(3),
      name: "L'Alliance Café ô Ça",
      street: '3400 Rue Jean-Talon E',
      city: 'Montréal',
      province: 'QC',
      postalcode: 'H2R 2W3',
      cname: 'Luc Côté',
      cnumber: '514-555-0142',
      cemail1: 'comptes@cafenord.ca',
      salesp: 'Sophie Dubé',
    },
    {
      id: raw(4),
      name: 'Hydro One Networks',
      street: '100 Consilium Pl',
      city: 'Toronto',
      province: 'ON',
      postalcode: 'M5H 2N2',
      cname: 'Priya Raman',
      cnumber: '416-555-0177',
      cemail1: 'billing@duval.qc.ca',
      salesp: 'Derek Chan',
    },
    {
      id: raw(5),
      name: 'Café Nord "Centre"',
      street: '750 Boulevard Industriel',
      city: 'Laval',
      province: 'QC',
      postalcode: 'H2R 2W3',
      cname: 'Hélène Girard',
      cnumber: '514-555-0123',
      cemail1: 'ops@cafenord.ca',
      salesp: 'Marc Tremblay',
    },
    {
      id: raw(6),
      name: 'Équipement Duval Ltée',
      street: '5650 Rue Hochelaga',
      city: 'Montréal',
      province: 'QC',
      postalcode: 'H2R 2W3',
      cname: 'André Combes',
      cnumber: '514-555-0110',
      cemail1: 'atelier@duval.qc.ca',
      salesp: 'Sophie Dubé',
    },
  ],
  sites: [
    { id: raw(1), custid: raw(1), name: 'Alliance - Distribution Centre', city: 'Toronto' },
    {
      id: raw(2),
      custid: raw(1),
      name: 'Alliance - Scarborough',
      city: 'Scarborough',
      notes: 'Dock door code 4411.\nKey at security desk.',
    },
    { id: raw(3), custid: raw(2), name: 'CLS - Head Office', city: 'Toronto' },
    { id: raw(4), custid: raw(3), name: 'Café Nord - Plateau', city: 'Montréal' },
    { id: raw(5), custid: raw(4), name: 'Hydro One - Sudbury Depot', city: 'Sudbury' },
    { id: raw(6), custid: raw(5), name: 'Café Nord - Laval', city: 'Laval' },
    // custid 9001 and 9002 have no customer row: orphan billing customer.
    { id: raw(7), custid: raw(9001), name: 'Legacy Site A (no billing customer)', city: 'Ottawa' },
    {
      id: raw(8),
      custid: raw(9002),
      name: 'Legacy Site B (no billing customer)',
      city: 'Winnipeg',
    },
  ],
  workorder: [
    {
      // Placeholder 0: the portal import writes a row before it has a number.
      id: raw(0),
      site: raw(1),
      customer: raw(1),
      datetaken: '0000-00-00',
      expcompletion: '0000-00-00',
      servicerequired: 'Placeholder work order created by the portal import',
      notes: null,
      status: raw(1),
      servicetype: raw(1),
      priority: raw(1),
      dne: raw(1),
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(1001),
      site: raw(1),
      customer: raw(1),
      status: raw(2),
      servicetype: raw(1),
      priority: raw(2),
      notes: 'Driver replaced and output verified.',
      servicerequired: 'Replace ballast in two fixtures',
      wo_folder_attach_path: 'C:\\alliance\\wo\\2025\\1001',
      completiondate: '2025-03-14',
      invdate: '2025-03-18',
      customerpo: 'PO-2001',
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(1002),
      site: raw(2),
      customer: raw(2),
      status: raw(3),
      servicerequired: 'Emergency lighting inspection',
      // Empty string, not NULL: the form writes "" when the field is cleared.
      notes: '',
      // A zero date can hide in a varchar column too.
      completiondate: '0000-00-00',
      local: raw(0),
      schannel: raw(0),
    },
    {
      // workorder.customer is a *site* id in legacy; 7777 has no sites row.
      id: raw(1003),
      site: raw(3),
      customer: raw(7777),
      status: raw(1),
      servicerequired: 'Repair parking lot pole light',
      notes: 'No site record found for this customer id.',
      local: raw(0),
      schannel: raw(0),
    },
    {
      // Site set, customer blank: precedence rule in §2.6 applies.
      id: raw(1004),
      site: raw(6),
      customer: '',
      status: raw(1),
      servicerequired: 'Replace exit sign battery',
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(1005),
      site: raw(1),
      customer: raw(1),
      status: raw(2),
      // Escaped newline and latin1 accents in the same row.
      notes: 'Replaced ballast.\nTested emergency circuit.\nLeft site at 16:30.',
      servicerequired: 'Réparation du luminaire extérieur, façade ô côté',
      local: raw(1),
      schannel: raw(0),
    },
    {
      id: raw(1006),
      site: raw(2),
      customer: raw(2),
      status: raw(2),
      datetaken: '0000-00-00',
      expcompletion: '2025-01-31',
      invdate: '0000-00-00',
      servicerequired: 'Troubleshoot photocell',
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(1007),
      site: raw(3),
      customer: raw(3),
      status: raw(3),
      servicerequired: 'Lamp replacement, 24 fixtures',
      notes: null,
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(1008),
      site: raw(4),
      customer: raw(4),
      status: raw(1),
      servicerequired: 'Réparer le panneau de contrôle',
      notes: 'Vérifier le câblage et la boîte de jonction.',
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(1009),
      site: raw(5),
      customer: raw(5),
      status: raw(4),
      servicerequired: 'Remove damaged troffer',
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(9999998),
      site: raw(2),
      customer: raw(2),
      status: raw(1),
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(9999999),
      site: raw(3),
      customer: raw(3),
      status: raw(1),
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(44444444),
      site: raw(4),
      customer: raw(4),
      status: raw(1),
      local: raw(0),
      schannel: raw(0),
    },
    {
      id: raw(99999999),
      site: raw(5),
      customer: raw(5),
      status: raw(1),
      local: raw(0),
      schannel: raw(0),
    },
  ],
  wo_parts: [
    { id: raw(1), woid: raw(1001), partno: 'CLS-1001', qty: raw('2.00'), price: raw('45.00') },
    { id: raw(2), woid: raw(1002), partno: 'CLS-1002', qty: raw('1.00'), price: raw('120.50') },
    { id: raw(3), woid: raw(1003), partno: '---', qty: raw('1.00'), price: raw('0.00') },
    { id: raw(4), woid: raw(1004), partno: '--', qty: raw('3.00'), price: raw('12.75') },
    // Four orphan lines: the parent work order is not in workorder.
    { id: raw(5), woid: raw(88888881), partno: 'CLS-1005', qty: raw('1.00'), price: raw('9.99') },
    { id: raw(6), woid: raw(88888882), partno: 'CLS-1006', qty: raw('1.00'), price: raw('18.40') },
    { id: raw(7), woid: raw(88888883), partno: 'CLS-1007', qty: raw('2.00'), price: raw('7.25') },
    { id: raw(8), woid: raw(88888884), partno: 'CLS-1008', qty: raw('1.00'), price: null },
  ],
  inv_hours: [
    {
      id: raw(1),
      woid: raw(1001),
      date: '2025-03-12',
      hours: raw('3.50'),
      hourly_rate: raw('95.00'),
    },
    {
      id: raw(2),
      woid: raw(1002),
      date: '2025-03-13',
      hours: raw('2.00'),
      hourly_rate: raw('95.00'),
    },
    {
      id: raw(3),
      woid: raw(1003),
      date: '2025-03-14',
      hours: raw('1.25'),
      hourly_rate: raw('110.00'),
    },
    {
      id: raw(4),
      woid: raw(1006),
      date: '0000-00-00',
      hours: raw('4.00'),
      entered_rate: '$95.00',
      hourly_rate: raw('95.00'),
    },
  ],
  inv_parts: [
    {
      id: raw(1),
      woid: raw(1001),
      partno: 'CLS-1001',
      qty: raw('2.00'),
      price: raw('45.00'),
      entered_price: '$45.00',
    },
    {
      id: raw(2),
      woid: raw(1002),
      partno: 'CLS-1002',
      qty: raw('1.00'),
      price: raw('120.50'),
      entered_price: '120.50',
    },
    {
      id: raw(3),
      woid: raw(1003),
      partno: 'CLS-1003',
      qty: raw('4.00'),
      price: raw('12.75'),
      is_local_part: raw(0),
    },
    // Orphan invoice line: no workorder row owns it.
    {
      id: raw(4),
      woid: raw(88888881),
      partno: 'CLS-1004',
      qty: raw('1.00'),
      price: raw('9.99'),
    },
    {
      // woid and applied_woid disagree, and applied_woid is a placeholder.
      id: raw(5),
      woid: raw(1005),
      applied_woid: '99999999',
      partno: 'CLS-1009',
      qty: raw('2.00'),
      price: raw('33.10'),
      is_local_part: raw(1),
    },
  ],
  inv_project: [
    { id: raw(1), woid: raw(1001), sage_project_workorder: '1001' },
    // sage_project_workorder disagrees with woid on purpose.
    { id: raw(2), woid: raw(1002), sage_project_workorder: '1003' },
    // Never set: NULL, unlike row 5 which was cleared to an empty string.
    { id: raw(3), woid: raw(0), sage_project_workorder: null },
    // Orphan: the project points at a work order that does not exist.
    { id: raw(4), woid: raw(88888882), sage_project_workorder: '88888882' },
    // Empty string versus NULL: the fifth row was cleared, not never set.
    { id: raw(5), woid: raw(1005), sage_project_workorder: '' },
  ],
  inv_tax: [
    {
      id: raw(1),
      woid: raw(1001),
      name: 'HST',
      calc_type: 'sub',
      appliedtaxrate: '13.000',
      tax_amount: '',
      subtotal_amount: '',
      total_amount: '113.00',
    },
    {
      id: raw(2),
      woid: raw(1002),
      name: 'HST',
      calc_type: 'sub_project',
      appliedtaxrate: '13.000',
      tax_amount: '$13.00',
      subtotal_amount: '$100.00',
      total_amount: '$113.00',
    },
    {
      id: raw(3),
      woid: raw(1003),
      name: 'GST',
      calc_type: 'local',
      tax_amount: 'n/a',
      subtotal_amount: null,
      total_amount: null,
    },
    {
      // Zero owed: dAmtOwg is 0.00 in the legacy screen, so the line is real.
      id: raw(4),
      woid: raw(1004),
      name: 'HST',
      calc_type: 'local_project',
      tax_amount: '0.00',
      subtotal_amount: '0.00',
      total_amount: '0.00',
    },
    {
      id: raw(5),
      woid: raw(88888881),
      name: 'PST',
      calc_type: 'sub',
      tax_amount: '5.50',
      subtotal_amount: '55.00',
      total_amount: '60.50',
    },
    {
      id: raw(6),
      woid: raw(0),
      name: 'HST',
      calc_type: 'sub',
      tax_amount: '13.00',
      subtotal_amount: '100.00',
      total_amount: '113.00',
    },
  ],
  inv_soparts: [
    {
      id: raw(1),
      woid: raw(1001),
      name: 'Emergency light head',
      qty: raw('2.00'),
      price: raw('85.00'),
      entered_price: '$85.00',
    },
    {
      id: raw(2),
      woid: raw(1002),
      name: 'Labour - after hours',
      qty: raw('1.00'),
      price: raw('190.00'),
      applied_woid: '1002',
    },
    {
      id: raw(3),
      woid: raw(1005),
      name: 'Luminaire extérieur DEL',
      qty: raw('1.00'),
      price: raw('410.00'),
      applied_woid: '1005',
    },
  ],
  po_invoice: [
    {
      id: raw(1),
      poid: raw(1),
      invoicenumber: 'INV-1001',
      tax_amount: raw('13.00'),
      tax_code: 'HST',
      sub_total: '100.00',
      total_amount: '113.00',
      invoice_date: '2025-02-03',
      date_created: '2025-02-03',
      invoice_level: raw(1),
      is_invoiced: raw(1),
    },
    {
      id: raw(2),
      poid: raw(2),
      invoicenumber: 'INV-1002',
      tax_amount: raw('0.00'),
      tax_code: 'HST',
      // Blank money: never zero-filled.
      sub_total: '',
      total_amount: '',
      shipping_charges: '',
      invoice_date: '2025-02-10',
      date_created: '2025-02-10',
    },
    {
      id: raw(3),
      poid: raw(3),
      invoicenumber: 'INV-1003',
      tax_amount: raw('160.49'),
      tax_code: 'HST',
      sub_total: '1,234.50',
      total_amount: '$1,234.50',
      invoice_date: '0000-00-00',
      date_created: '2025-02-14',
    },
    {
      id: raw(4),
      poid: raw(4),
      invoicenumber: 'INV-1004',
      tax_amount: raw('0.00'),
      tax_code: 'HST',
      sub_total: null,
      total_amount: 'n/a',
      invoice_date: null,
      date_created: '2025-02-20',
    },
  ],
  po_invoice_parts: [
    {
      id: raw(1),
      poid: raw(1),
      invoice_id: raw(1),
      partno: 'CLS-1001',
      price: '45.00',
      linetotal: '90.00',
      qty: raw('2.00'),
      actual_qty: raw('2.00'),
    },
    {
      id: raw(2),
      poid: raw(2),
      invoice_id: raw(2),
      partno: 'CLS-1002',
      price: '',
      linetotal: '',
      qty: raw('1.00'),
      actual_qty: raw('1.00'),
    },
    {
      id: raw(3),
      poid: raw(3),
      invoice_id: raw(3),
      partno: '---',
      price: 'n/a',
      linetotal: 'n/a',
      qty: raw('10.00'),
      actual_qty: raw('0.00'),
      backorder_qty: raw('10.00'),
    },
    {
      id: raw(4),
      poid: raw(4),
      invoice_id: raw(4),
      partno: 'CLS-1004',
      price: '$1,234.50',
      linetotal: '$2,469.00',
      qty: raw('2.00'),
      actual_qty: raw('2.00'),
      model_number: at(MODEL_NUMBERS, 3),
    },
  ],
  po_parts: [
    {
      id: raw(1),
      poid: raw(1),
      partno: 'CLS-1001',
      qty: raw('2.00'),
      qty_received: raw('2.00'),
      price: '45.00',
    },
    // Blank price.
    {
      id: raw(2),
      poid: raw(1),
      partno: 'CLS-1002',
      qty: raw('1.00'),
      qty_received: raw('0.00'),
      price: '',
    },
    // Dollar-formatted price in a varchar column.
    {
      id: raw(3),
      poid: raw(2),
      partno: 'CLS-1003',
      qty: raw('4.00'),
      qty_received: raw('4.00'),
      price: '$1,234.50',
    },
    // Non-numeric price.
    {
      id: raw(4),
      poid: raw(2),
      partno: 'CLS-1004',
      qty: raw('3.00'),
      qty_received: raw('1.00'),
      price: 'n/a',
    },
    // Over-received: the new model needs a receipt larger than the order.
    {
      id: raw(5),
      poid: raw(3),
      partno: 'CLS-1005',
      qty: raw('2.00'),
      qty_received: raw('5.00'),
      price: '9.99',
    },
    {
      id: raw(6),
      poid: raw(4),
      partno: 'CLS-1006',
      qty: raw('6.00'),
      qty_received: raw('6.00'),
      price: '18.40',
    },
    {
      id: raw(7),
      poid: raw(5),
      partno: 'CLS-1007',
      qty: raw('2.00'),
      qty_received: raw('0.00'),
      price: '7.25',
    },
    {
      id: raw(8),
      poid: raw(6),
      partno: 'CLS-1008',
      qty: raw('1.00'),
      qty_received: raw('1.00'),
      price: '12.75',
    },
    {
      id: raw(9),
      poid: raw(7),
      partno: 'CLS-1009',
      qty: raw('12.00'),
      qty_received: raw('10.00'),
      price: '3.40',
    },
    {
      id: raw(10),
      poid: raw(8),
      partno: '---',
      qty: raw('1.00'),
      qty_received: raw('0.00'),
      price: '',
    },
  ],
  wo_revisions: [
    {
      revision_id: raw(1),
      woid: raw(1001),
      revised_by_user: raw(1),
      revision_type: 'manual',
      data_workorder: '{"id":1001,"status":2}',
      is_last_revision: raw(1),
    },
    {
      revision_id: raw(2),
      woid: raw(1005),
      revised_by_user: raw(2),
      revision_type: 'manual',
      // Binary literal: the legacy schema declares no BLOB column, so the hex
      // case lives in the serialized revision payload the app wrote raw.
      data_workorder: hex('DEADBEEF'),
      is_last_revision: raw(1),
    },
  ],
  wo_images_cropped: [
    { id: raw(1), woid: raw(1001), cropped_time: '2025-03-14 09:30:00' },
    { id: raw(2), woid: raw(1002), cropped_time: '2025-03-15 11:05:00' },
  ],
  wo_notes: [
    {
      id: raw(1),
      woid: raw(1001),
      user_id: raw(1),
      notes: 'Called site contact; access confirmed for 8:00.',
      title: 'Dispatch note',
      notes_type: 'status',
      previous_status_id: raw(1),
      status_id: raw(2),
      is_public: raw(1),
      date_created: '2025-03-12 08:12:00',
    },
    {
      id: raw(2),
      woid: raw(1001),
      user_id: raw(4),
      notes: 'Ballast replaced. Vérifier le niveau de luminosité.',
      title: 'Work performed',
      notes_type: 'note',
      previous_status_id: raw(2),
      status_id: raw(3),
      is_public: raw(0),
      date_created: '2025-03-14 16:40:00',
    },
    {
      id: raw(3),
      woid: raw(1002),
      user_id: raw(2),
      notes: 'Client asked to reschedule to Friday.',
      title: 'Reschedule',
      notes_type: 'note',
      previous_status_id: raw(1),
      status_id: raw(1),
      is_public: raw(1),
      date_created: '2025-03-13 09:05:00',
    },
    {
      id: raw(4),
      woid: raw(1008),
      user_id: raw(10),
      notes: null,
      title: 'Empty note, kept for history',
      notes_type: 'note',
      is_public: raw(0),
      date_created: '0000-00-00 00:00:00',
    },
  ],
  customer_quote: [
    {
      id: raw(1),
      workordernumber: raw(1001),
      site: raw(1),
      status: raw(3),
      createdby: raw(1),
      tax_amount: '113.00',
      date_created: '2025-02-01',
      notes: 'Quote approved by site contact.',
    },
    {
      id: raw(2),
      workordernumber: raw(1002),
      site: raw(2),
      status: raw(2),
      createdby: raw(3),
      tax_amount: '$1,234.50',
      date_created: '2025-02-04',
    },
    {
      id: raw(3),
      workordernumber: raw(1003),
      site: raw(7),
      status: raw(1),
      createdby: raw(2),
      tax_amount: '',
      date_created: '2025-02-06',
    },
    {
      id: raw(4),
      workordernumber: raw(1005),
      site: raw(5),
      status: raw(4),
      createdby: raw(4),
      tax_amount: 'n/a',
      date_created: '0000-00-00',
      notes: 'Rejected: budget moved to next fiscal year.',
    },
    {
      id: raw(5),
      workordernumber: raw(0),
      site: raw(6),
      status: raw(1),
      createdby: raw(5),
      tax_amount: '0.00',
      date_created: '2025-02-11',
    },
  ],
  purchaseorder: [
    {
      id: raw(1),
      purchase_order_number: 'PO-2001',
      supplier_id: raw(1),
      customerid: raw(1),
      status: raw(4),
      priority: raw(2),
      date_created: '2025-02-01 09:00:00',
      createdby: raw(1),
      tax_code: 'HST',
      appliedtaxrate: '13.000',
    },
    {
      id: raw(2),
      purchase_order_number: 'PO-2002',
      supplier_id: raw(2),
      customerid: raw(2),
      status: raw(3),
      priority: raw(1),
      date_created: '2025-02-03 10:30:00',
      createdby: raw(3),
      tax_code: 'HST',
      appliedtaxrate: '13.000',
    },
    {
      id: raw(3),
      purchase_order_number: 'PO-2003',
      supplier_id: raw(3),
      customerid: raw(3),
      status: raw(5),
      priority: raw(3),
      date_created: '2025-02-05 14:15:00',
      createdby: raw(2),
      tax_code: 'HST',
      appliedtaxrate: '13.000',
    },
    {
      id: raw(4),
      purchase_order_number: 'PO-2004',
      supplier_id: raw(4),
      customerid: raw(4),
      status: raw(2),
      priority: raw(1),
      date_created: '2025-02-07 08:45:00',
      createdby: raw(5),
      tax_code: 'HST',
      appliedtaxrate: '13.000',
    },
    {
      id: raw(5),
      purchase_order_number: 'PO-2005',
      supplier_id: raw(1),
      customerid: raw(5),
      status: raw(1),
      priority: raw(2),
      date_created: '2025-02-09 11:20:00',
      createdby: raw(1),
    },
    {
      id: raw(6),
      purchase_order_number: 'PO-2006',
      supplier_id: raw(2),
      customerid: raw(6),
      status: raw(4),
      priority: raw(1),
      date_created: '2025-02-11 13:05:00',
      createdby: raw(3),
    },
    {
      id: raw(7),
      purchase_order_number: 'PO-2007',
      supplier_id: raw(3),
      status: raw(3),
      priority: raw(3),
      date_created: '2025-02-13 15:40:00',
      createdby: raw(4),
    },
    {
      id: raw(8),
      purchase_order_number: 'PO-2008',
      supplier_id: raw(4),
      status: raw(1),
      priority: raw(1),
      date_created: '2025-02-15 07:55:00',
      createdby: raw(5),
    },
  ],
  parts: [
    {
      id: raw(1),
      number: 'CLS-1001',
      name: 'Ballast 2-lamp T8 electronic',
      cost: raw('22.50'),
      sell_price: raw('45.00'),
      part_group_id: raw(1),
      current_quantity: raw('18.00'),
      purchased_quantity: raw('40.00'),
      sold_quantity: raw('22.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(2),
      number: 'CLS-1002',
      name: 'Lamp LED T8 4ft 12W',
      cost: raw('8.40'),
      sell_price: raw('18.75'),
      part_group_id: raw(1),
      current_quantity: raw('240.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(3),
      number: 'CLS-1003',
      name: 'Exit sign LED emergency',
      cost: raw('61.20'),
      sell_price: raw('120.50'),
      part_group_id: raw(2),
      current_quantity: raw('7.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(4),
      number: 'CLS-1004',
      name: 'Emergency battery unit 90 min',
      cost: raw('48.00'),
      sell_price: raw('95.00'),
      part_group_id: raw(2),
      current_quantity: raw('0.00'),
      active_in_sage: raw(0),
    },
    {
      id: raw(5),
      number: 'CLS-1005',
      name: 'Lens diffuser 2x4',
      cost: raw('6.10'),
      sell_price: raw('12.75'),
      part_group_id: raw(3),
      current_quantity: raw('54.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(6),
      number: 'CLS-1006',
      name: 'Troffer door frame',
      cost: raw('11.25'),
      sell_price: raw('24.00'),
      part_group_id: raw(3),
      current_quantity: raw('31.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(7),
      number: 'CLS-1007',
      name: 'Occupancy sensor ceiling mount',
      cost: raw('34.80'),
      sell_price: raw('72.00'),
      part_group_id: raw(1),
      current_quantity: raw('12.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(8),
      number: 'CLS-1008',
      name: 'Fluorescent lamp F32T8',
      cost: raw('2.75'),
      sell_price: raw('6.50'),
      part_group_id: raw(1),
      current_quantity: raw('410.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(9),
      number: 'CLS-1009',
      name: 'Emergency light head',
      cost: raw('41.00'),
      sell_price: raw('85.00'),
      part_group_id: raw(2),
      current_quantity: raw('5.00'),
      active_in_sage: raw(1),
    },
    {
      id: raw(10),
      number: 'CLS-1010',
      name: 'Photocell 120V',
      cost: raw('13.30'),
      sell_price: raw('29.95'),
      part_group_id: raw(3),
      current_quantity: raw('0.00'),
      active_in_sage: raw(0),
    },
  ],
  rga: [
    {
      id: raw(1),
      poid: raw(1),
      supplier_id: raw(1),
      site: raw(1),
      status: raw(1),
      workordernumber: '1001',
      request_date: '2025-03-20',
      date_created: '2025-03-20 10:00:00',
      createdby: raw(1),
      rga_notes: 'Defective ballast returned for credit.',
    },
    {
      id: raw(2),
      poid: raw(2),
      supplier_id: raw(2),
      site: raw(2),
      status: raw(2),
      workordernumber: '1002',
      request_date: '2025-03-22',
      date_created: '2025-03-22 11:30:00',
      createdby: raw(3),
    },
    {
      id: raw(3),
      poid: raw(3),
      supplier_id: raw(3),
      site: raw(3),
      status: raw(3),
      workordernumber: '1003',
      request_date: '2025-03-25',
      date_created: '2025-03-25 09:15:00',
      createdby: raw(2),
    },
    {
      id: raw(4),
      poid: raw(4),
      supplier_id: raw(4),
      site: raw(4),
      status: raw(4),
      workordernumber: '1004',
      request_date: null,
      date_created: '2025-03-28 14:45:00',
      createdby: raw(4),
    },
  ],
  wo_next_pid: [
    // Deliberately below the placeholder ids: the allocator must never issue them.
    { id: raw(1), next_id: raw(10010), comments: 'Next work order number after the freeze' },
  ],
}

// --- column-level rules ------------------------------------------------------

/** Values that a name-based rule would get wrong; keyed `table.column`. */
const COLUMN_OVERRIDES: Record<string, (index: number) => Cell> = {
  'parts.number': (index) => at(PART_NUMBERS, index),
  'parts.name': (index) => at(PART_DESCRIPTIONS, index),
  'parts.parent_partnumber': (index) => (index === 0 ? null : at(PART_NUMBERS, index + 1)),
  'parts.cls_linked_partcode': (index) => at(PART_NUMBERS, index + 2),
  'parts_selling_rates.part_code': (index) => at(PART_NUMBERS, index),
  'parts_supplier_rates.part_code': (index) => at(PART_NUMBERS, index),
  'wo_hours.rate': (index) => raw((index % 3) + 1),
  'localwo_hours.timein': () => '07:30:00',
  'localwo_hours.timeout': () => '16:00:00',
  'wo_next_pid.next_id': () => raw(10010),
  'cron_run_history.execute_timeint': (index) => raw(1735689600 + index * 86400),
  'wo_invoiceno.invoiceno': (index) => `SAGE-${5100 + index}`,
  'messages.datetime': (index) => `2025-03-0${(index % 9) + 1} 09:15:00`,
  'shared_parts_list.partcode': (index) => at(PART_NUMBERS, index),
  'shared_parts_list.main_partcode': (index) => at(PART_NUMBERS, index + 1),
}

/** Rate columns are stored as text in the legacy schema but are not money. */
const RATE_TEXT_COLUMNS: Record<string, string> = {
  appliedtaxrate: '13.000',
  appliedtaxrate_pst: '0.000',
  appliedtaxrate_gst: '5.000',
  tax_code: 'HST',
}

const MONEY_COLUMN =
  /(price|cost|amount|total|subtotal|tax|charge|discount|balance|markup|profit|owed|install|recycle|rate)/i
const QUANTITY_COLUMN =
  /(qty|quantity|hours|numtechs|percent|revision_no|sortorder|level|timespan|defaultsortorder|sort_id|word_count)/i

const MONEY_TEXT = ['45.00', '1,234.50', '$95.00', '0.00', '12.50', '410.00']

function isIntegerType(type: string): boolean {
  return /^(tinyint|smallint|mediumint|int|bigint)/.test(type)
}

function isDecimalType(type: string): boolean {
  return /^(decimal|float|double)/.test(type)
}

function isTextType(type: string): boolean {
  return /^(varchar|char|tinytext|text|mediumtext|longtext)/.test(type)
}

function enumLabels(type: string): string[] {
  const labels: string[] = []
  for (const match of type.matchAll(/'([^']*)'/g)) labels.push(match[1] ?? '')
  return labels.filter((label) => label !== '')
}

function textFor(table: string, column: LegacyColumn, index: number, rng: () => number): Cell {
  const name = column.name

  const labels = LOOKUP_LABELS[table]
  if (labels && name === 'name') return at(labels, index)

  switch (name) {
    case 'name':
    case 'title':
    case 'subject':
    case 'contact_name':
    case 'contact_person':
    case 'cname':
    case 'list_heading':
    case 'document_name':
    case 'revised_by':
    case 'locked_by':
      return table === 'customer' || table === 'suppliers'
        ? pick(COMPANY_NAMES, rng)
        : pick(PERSON_NAMES, rng)
    case 'street':
    case 'street_1':
    case 'ShipStrt1':
    case 'transfer_from_street1':
      return pick(STREETS, rng)
    case 'ShipStrt2':
    case 'street_2':
    case 'transfer_from_street2':
      return index % 3 === 0 ? 'Suite 200' : null
    case 'city':
    case 'ShipCity':
    case 'transfer_from_city':
      return pick(CITIES, rng)
    case 'province':
    case 'ShipPrvSt':
    case 'transfer_from_province':
      return pick(PROVINCES, rng)
    case 'postalcode':
    case 'ShipPstZp':
    case 'transfer_from_postalcode':
      return pick(POSTAL_CODES, rng)
    case 'cnumber':
    case 'contact_number':
    case 'phone':
    case 'ship_address_phone':
    case 'transfer_from_phone':
      return pick(PHONES, rng)
    case 'email':
    case 'cemail1':
    case 'cemail2':
    case 'cemail3':
    case 'additional_emails':
      return pick(EMAILS, rng)
    case 'username':
      return `user${index + 1}`
    case 'password':
      return MD5_PASSWORD
    case 'model_number':
    case 'model_number_1':
    case 'model_number_2':
    case 'model_number_3':
      return pick(MODEL_NUMBERS, rng)
    case 'notes':
    case 'report':
    case 'description':
    case 'supplier_notes':
    case 'popnotes':
    case 'part_popup_notes':
    case 'rejected_reason':
    case 'reason_for_return':
    case 'log_type':
    case 'notes_comments':
    case 'invoice_report':
    case 'rga_notes':
    case 'sub_notes':
    case 'revision_notes':
    case 'pdf_notes':
    case 'data_workorder':
    case 'data_work_hours':
    case 'data_quote':
      return pick(NOTE_TEXTS, rng)
    case 'invoice_number':
    case 'invoicenumber':
    case 'invoice_no':
    case 'po_number':
      return `INV-${4100 + index}`
    case 'purchase_order_number':
      return `PO-${2000 + index}`
    case 'file_name':
      return `document-${index + 1}.pdf`
    case 'trackingid':
      return `1Z${String(100000 + index)}`
    case 'securitycode':
      return `SC-${4000 + index}`
    case 'php_filename':
      return 'wp-admin/workorders/update.php'
    case 'table_name':
      return 'workorder'
    case 'cronname':
      return index % 2 === 0 ? 'signoff_cron' : 'price_history_cron'
    case 'runtime':
      return index % 2 === 0 ? '00:01:12' : '00:00:04'
    case 'fob':
      return 'FOB Destination'
    case 'pay_terms':
      return 'Net 30'
    case 'ship_via':
      return 'Purolator'
    case 'dns':
      return index % 2 === 0 ? 'internal' : 'external'
    case 'lift':
      return `L${index + 1}`
    case 'phone2':
      return pick(PHONES, rng)
    case 'phone2_ext':
    case 'phone_ext':
      return String(100 + index)
    case 'keep_warranty':
      return index % 2 === 0 ? '1' : '0'
    case 'permission_name':
      return at(
        [
          'workorders.view',
          'workorders.edit',
          'quotes.edit',
          'purchasing.approve',
          'reports.view',
          'users.admin',
        ],
        index,
      )
    case 'supplier_warranty':
      return '1 year'
    case 'field_name':
      return at(['sell_price', 'cost', 'install_price', 'recycle_price'], index)
    case 'last_value':
    case 'new_value':
      return pick(MONEY_TEXT, rng)
    case 'user_name':
      return pick(PERSON_NAMES, rng)
    case 'tech':
      return pick(PERSON_NAMES, rng)
    case 'document_type':
      return at(['wsib', 'insurance', 'wcb'], index)
    case 'printed':
      return index % 2 === 0 ? '1' : '0'
    case 'is_pma_bckup':
      return '0'
    case 'pma_order_category':
      return at(['Fire Alarm', 'Lighting', 'Emergency'], index)
    case 'primary_workorder':
    case 'item_purchase_type_number':
    case 'item_transferfrom_type_number':
    case 'sageprojectno':
    case 'invoice_project':
      return String(at(WORK_ORDER_IDS, index))
    case 'sc_primary_status':
    case 'sc_extended_status':
      return at(['new', 'in_progress', 'completed', 'cancelled'], index)
    case 'shipping_code':
      return 'PICKUP'
    case 'shipment_type_correction':
    case 'shipment_type_bkup_18july2025':
      return at(['alliance', 'cls', 'customer'], index)
    case 'tjx_parts_qty_type':
      return 'each'
    case 'transfer_from_company':
      return pick(COMPANY_NAMES, rng)
    case 'po_submitted_by':
      return 'jsmith'
    case 'item_transferfrom_type':
    case 'item_purchase_type':
      return at(['workorder', 'stock', 'cls', 'projectpo'], index)
    case 'cls_invoicenumber':
      return `CLS-${4100 + index}`
    case 'status':
      return at(['received', 'sold', 'adjustment', 'open', 'in_progress', 'done'], index)
    case 'qty':
    case 'on_field_counted_qty':
    case 'return_qty':
    case 'part_ratio_perfixture':
      return String((index % 5) + 1)
    case 'stock_identifier':
      return `STK-${1000 + index}`
    case 'transaction_type':
      return at(['purchase', 'sale', 'adjustment'], index)
    case 'linked_part_sopart':
      return 'Emergency light head'
    case 'warranty_years':
    case 'labor_warranty_years':
      return '1'
    case 'rga_invoicenumber':
      return `RGA-${3000 + index}`
    case 'rga_invoicedate':
    case 'rp_invoicedate':
    case 'invoice_date':
    case 'due_date':
      return `2025-03-${String((index % 27) + 1).padStart(2, '0')}`
    case 'rga_type':
      return at(['vendor_return', 'warranty'], index)
    case 'replacement_type':
      return at(['credit', 'replacement'], index)
    case 'ship_to_type':
      return 'site'
    case 'quote_type':
      return 'tjx'
    case 'revision_type':
      return 'manual'
    case 'notify_type':
      return 'email'
    case 'section':
      return 'workorder'
  }

  if (table === 'wo_categories' && name === 'code') {
    return at(LOOKUP_CODES.wo_categories ?? [], index)
  }
  if (name === 'partno' || name === 'part_no' || name === 'part_code') {
    return at(PART_NUMBERS, index)
  }
  if (/date$/.test(name)) return `2025-03-${String((index % 27) + 1).padStart(2, '0')}`
  // Long text columns get a sentence; short ones get a word, never a paragraph
  // in a varchar(10).
  if (column.type.includes('text')) return pick(NOTE_TEXTS, rng)
  return pick(SHORT_WORDS, rng)
}

function cellFor(table: string, column: LegacyColumn, index: number, rng: () => number): Cell {
  const name = column.name
  const key = `${table}.${name}`
  const override = COLUMN_OVERRIDES[key]
  if (override) return override(index)

  if (!column.notNull && rng() < 0.08) return null

  if (isIntegerType(column.type)) {
    const foreign = FOREIGN_KEY_COLUMNS[name]
    if (foreign) return raw(at(foreign, index))
  }

  if (name === 'workordernumber' || name === 'applied_woid' || name === 'reference_wo_number') {
    const workOrder = at(WORK_ORDER_IDS, index)
    return isIntegerType(column.type) ? raw(workOrder) : raw(String(workOrder))
  }
  if (table === 'workorder' && name === 'customer_quote_id') {
    return raw(String(at(CUSTOMER_QUOTE_IDS, index)))
  }

  if (isTextType(column.type)) {
    const rateText = RATE_TEXT_COLUMNS[name]
    if (rateText !== undefined) return rateText
    if (!column.notNull && rng() < 0.05) return ''
    if (MONEY_COLUMN.test(name)) return pick(MONEY_TEXT, rng)
    return textFor(table, column, index, rng)
  }

  if (isDecimalType(column.type)) {
    if (MONEY_COLUMN.test(name)) {
      // Column name offsets the amount so a row's tax, freight and total differ.
      const offset = (seedFor(name) % 400) / 100
      return raw((12.5 + index * 7.25 + offset).toFixed(2))
    }
    return raw((1 + (index % 7)).toFixed(2))
  }

  if (column.type.startsWith('enum')) {
    const labels = enumLabels(column.type)
    return labels.length > 0 ? pick(labels, rng) : ''
  }

  if (QUANTITY_COLUMN.test(name)) return raw((index % 4) + 1)

  if (column.type === 'date') {
    return index % 5 === 4 ? '0000-00-00' : `2025-03-${String((index % 27) + 1).padStart(2, '0')}`
  }
  if (column.type === 'datetime' || column.type === 'timestamp') {
    return `2025-03-${String((index % 27) + 1).padStart(2, '0')} 09:30:00`
  }
  if (column.type === 'time') return '08:30:00'
  if (column.type === 'year') return raw(2025)

  if (isIntegerType(column.type)) return raw((index % 9) + 1)

  return `${name}-${index + 1}`
}

function generateRow(table: string, definition: LegacyTable, index: number): LegacyRow {
  const rng = mulberry32(seedFor(`${table}:${index}`))
  const row: LegacyRow = {}
  for (const column of definition.columns) {
    row[column.name] = cellFor(table, column, index, rng)
  }
  return row
}

function rowsFor(
  table: string,
  definition: LegacyTable,
  count: number,
  rulesTable = table,
): LegacyRow[] {
  // A dated copy is a snapshot of real data: it gets one ordinary row, never a
  // case row borrowed from the table it copies.
  const special = table === rulesTable ? SPECIAL_ROWS[rulesTable] : undefined
  if (special && special.length !== count) {
    throw new Error(`fixture rows for ${table} are ${special.length}, manifest expects ${count}`)
  }
  const rows: LegacyRow[] = []
  for (let index = 0; index < count; index += 1) {
    // A dated copy borrows the rules of the table it snapshots, not its own name.
    const row = generateRow(rulesTable, definition, index)
    // The primary key is generated, then the case row overrides what it must.
    const pk = definition.primaryKey[0]
    if (pk && !special) row[pk] = raw(index + 1)
    Object.assign(row, special?.[index] ?? {})
    rows.push(row)
  }
  return rows
}

// --- rendering ---------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  '\0': '\\0',
  '\n': '\\n',
  '\r': '\\r',
  '\\': '\\\\',
  "'": "\\'",
  '"': '\\"',
  '\u001a': '\\Z',
}

/** MySQL string literal with mysqldump's escaping; latin1 only, by construction. */
export function sqlString(value: string): string {
  let out = "'"
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint > 0xff) {
      throw new Error(`fixture text is not latin1: ${JSON.stringify(character)}`)
    }
    out += ESCAPES[character] ?? character
  }
  return `${out}'`
}

function renderCell(cell: Cell): string {
  if (cell === null) return 'NULL'
  if (typeof cell === 'string') return sqlString(cell)
  if ('hex' in cell) return `0x${cell.hex}`
  return cell.raw
}

function renderCreateTable(table: string, definition: LegacyTable): string {
  const columns = definition.columns.map((column) => {
    const autoIncrement =
      definition.primaryKey.length === 1 &&
      definition.primaryKey[0] === column.name &&
      isIntegerType(column.type)
    const suffix = column.notNull ? ' NOT NULL' : ' DEFAULT NULL'
    return `  \`${column.name}\` ${column.type}${suffix}${autoIncrement ? ' AUTO_INCREMENT' : ''}`
  })
  if (definition.primaryKey.length > 0) {
    const keys = definition.primaryKey.map((column) => `\`${column}\``).join(',')
    columns.push(`  PRIMARY KEY (${keys})`)
  }
  return [
    `CREATE TABLE \`${table}\` (`,
    columns.join(',\n'),
    `) ENGINE=${definition.engine} DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;`,
  ].join('\n')
}

function renderTable(table: string, definition: LegacyTable, rows: LegacyRow[]): string {
  const lines = [
    '',
    '--',
    `-- Table structure for table \`${table}\``,
    '--',
    '',
    `DROP TABLE IF EXISTS \`${table}\`;`,
    '/*!40101 SET @saved_cs_client     = @@character_set_client */;',
    '/*!50503 SET character_set_client = latin1 */;',
    renderCreateTable(table, definition),
    '/*!40101 SET character_set_client = @saved_cs_client */;',
    '',
    '--',
    `-- Dumping data for table \`${table}\``,
    '--',
    '',
    `/*!40000 ALTER TABLE \`${table}\` DISABLE KEYS */;`,
  ]
  if (rows.length > 0) {
    const tuples = rows.map(
      (row) =>
        `(${definition.columns.map((column) => renderCell(row[column.name] ?? null)).join(',')})`,
    )
    lines.push(`INSERT INTO \`${table}\` VALUES ${tuples.join(',')};`)
  }
  lines.push(`/*!40000 ALTER TABLE \`${table}\` ENABLE KEYS */;`, '')
  return `${lines.join('\n')}\n`
}

const DUMP_HEADER = `-- MySQL dump 10.13  Distrib 5.7.44, for Linux (x86_64)
--
-- Host: localhost    Database: alliance_db
-- ------------------------------------------------------
-- Server version\t5.7.44
--
-- Synthetic fixture for the migration rehearsal. Shapes are real (every column,
-- every table in the load manifest); values are fabricated. Encoded latin1 to match
-- the client dump command in the cutover plan (section 10 of the harness spec).
--
-- Table order follows the import manifest, not mysqldump's alphabetical order, so
-- a reader can walk the file top to bottom. Dated duplicate copies are appended
-- last: they must be seen and skipped, never loaded.

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES latin1 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

`

const DUMP_FOOTER = `
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-12  0:00:00
`

/** Dated duplicate copies: present in the file, absent from the load manifest. */
const DATED_DUPLICATES: { table: string; copyOf: string }[] = [
  { table: 'inv_parts_july_20_2025', copyOf: 'inv_parts' },
  { table: 'parts_backup_17dec25', copyOf: 'parts' },
  { table: 'po_status_v2', copyOf: 'po_status' },
  { table: 'workorder_backup_2025', copyOf: 'workorder' },
]

const NASTY_CASES: { case: string; where: string }[] = [
  {
    case: 'placeholder-work-order',
    where: 'workorder.id in (0, 9999998, 9999999, 44444444, 99999999)',
  },
  { case: 'duplicate-username', where: 'users.id in (1,2) both username jsmith' },
  { case: 'disabled-user', where: 'users.id in (3,4,5) is_enabled = 0' },
  {
    case: 'subcontractor-without-vendor',
    where: 'users.id = 6 subid = 99 has no subcontractor row',
  },
  { case: 'empty-email', where: "users.id = 7 email = '' (empty string, not NULL)" },
  {
    case: 'shared-company-email',
    where: 'users.id in (8,9) both email info@clsgreen.com',
  },
  {
    case: 'orphan-workorder-site',
    where: 'workorder.id = 1003 customer = 7777 has no sites row',
  },
  {
    case: 'site-without-customer',
    where: "workorder.id = 1004 site = 6 but customer = '' (empty string)",
  },
  {
    case: 'orphan-site-customer',
    where: 'sites.custid in (9001, 9002) have no customer row',
  },
  {
    case: 'orphan-work-order-line',
    where: 'wo_parts.woid in (88888881..88888884); inv_parts.woid = 88888881',
  },
  {
    case: 'unresolved-part-number',
    where: "wo_parts.partno in ('---','--'); po_invoice_parts.partno = '---'",
  },
  {
    case: 'four-orphan-wo-parts',
    where: 'wo_parts ids 5-8 reference work orders that do not exist',
  },
  {
    case: 'work-order-id-in-three-columns',
    where:
      'inv_tax.woid, inv_parts.applied_woid, inv_project.sage_project_workorder (the schema has woid plus the applied/project variants; no workorderid or wo_id column exists)',
  },
  {
    case: 'invoice-line-disagreement',
    where:
      'inv_parts.id = 5 woid = 1005 but applied_woid = 99999999; inv_project id 2 sage_project_workorder 1003 differs from woid 1002',
  },
  {
    case: 'blank-money',
    where:
      'inv_tax id 1 tax_amount; po_parts id 2 and id 10 price; po_invoice_parts id 2 price; po_invoice id 2 sub_total/total_amount',
  },
  {
    case: 'formatted-money',
    where:
      "inv_tax id 2 ($13.00/$100.00); po_parts id 3 price '$1,234.50'; po_invoice id 3 sub_total '1,234.50'",
  },
  {
    case: 'non-numeric-money',
    where:
      "inv_tax id 3 tax_amount 'n/a'; po_invoice_parts id 3 price 'n/a'; po_invoice id 4 total_amount 'n/a'",
  },
  {
    case: 'zero-money-owed',
    where: 'inv_tax id 4 tax_amount, subtotal_amount and total_amount all 0.00',
  },
  {
    case: 'qty-received-over-ordered',
    where: 'po_parts id 5 qty = 2.00 qty_received = 5.00',
  },
  {
    case: 'zero-date',
    where:
      'workorder.id 0 datetaken/expcompletion, id 1006 datetaken/invdate; inv_hours id 4 date; po_invoice id 3 invoice_date; customer_quote id 4 date_created',
  },
  {
    case: 'empty-string-versus-null',
    where:
      'workorder.notes (1002 empty, 1007 NULL); inv_project.sage_project_workorder (id 5 empty, id 3 NULL); po_invoice.sub_total (id 2 empty, id 4 NULL)',
  },
  {
    case: 'latin1-accents',
    where:
      'customer.name id 3; sites.name/notes; workorder.servicerequired id 1005 and 1008; users.full_name id 10',
  },
  {
    case: 'embedded-newline',
    where: 'workorder.notes id 1005 (escaped \\n); sites.notes id 2 (escaped \\n)',
  },
  {
    case: 'escaped-quote-and-backslash',
    where:
      'customer.name id 3 (L\\\'Alliance) and id 5 (\\"Centre\\"); workorder.wo_folder_attach_path id 1001 (C:\\\\alliance)',
  },
  {
    case: 'hex-literal',
    where:
      'wo_revisions.data_workorder revision_id 2 is 0xDEADBEEF (the legacy schema declares no BLOB column; wo_images_cropped holds only id, woid and cropped_time)',
  },
  {
    case: 'dated-duplicate-table',
    where:
      'inv_parts_july_20_2025, parts_backup_17dec25, po_status_v2, workorder_backup_2025 each present with 1 row and absent from the load manifest',
  },
  {
    case: 'next-id-below-max-placeholder',
    where: 'wo_next_pid.next_id = 10010 while workorder carries 99999999',
  },
]

/**
 * Rows must arrive in ascending primary-key order because the loader batches by
 * ascending source key; a fixture out of order would hide a resume bug.
 */
function assertKeyOrder(table: string, definition: LegacyTable, rows: LegacyRow[]): void {
  const pk = definition.primaryKey[0]
  if (!pk) return
  let previous: number | null = null
  for (const row of rows) {
    const cell = row[pk]
    if (cell === undefined || cell === null || typeof cell === 'string' || !('raw' in cell))
      continue
    const value = Number(cell.raw)
    if (!Number.isFinite(value)) continue
    if (previous !== null && value <= previous) {
      throw new Error(`${table}.${pk} is not ascending at ${value}`)
    }
    previous = value
  }
}

/**
 * The copies must stay classified as skipped, or a load would import dead data.
 * Checked on every build rather than trusted to a comment.
 */
function assertDatedCopiesAreSkipped(): void {
  for (const entry of DATED_DUPLICATES) {
    if (
      !SKIPPED_DATED_DUPLICATES.includes(entry.table as (typeof SKIPPED_DATED_DUPLICATES)[number])
    ) {
      throw new Error(`${entry.table} is not a classified dated duplicate`)
    }
    if (ALL_TABLES.some((manifestTable) => manifestTable.table === entry.table)) {
      throw new Error(`${entry.table} is in the load manifest; dated copies are never loaded`)
    }
    if (!legacy.tables[entry.copyOf]) {
      throw new Error(`dated copy ${entry.table} has no source table`)
    }
  }
}

export function buildFixture(): BuiltFixture {
  assertDatedCopiesAreSkipped()

  const blocks: string[] = [DUMP_HEADER]
  const tables: { table: string; rows: number }[] = []

  const entries: { table: string; copyOf: string; count: number }[] = [
    ...ALL_TABLES.map((entry) => ({
      table: entry.table,
      copyOf: entry.table,
      count: entry.fixtureRows,
    })),
    ...DATED_DUPLICATES.map((entry) => ({ table: entry.table, copyOf: entry.copyOf, count: 1 })),
  ]

  for (const entry of entries) {
    const definition = legacy.tables[entry.copyOf]
    if (!definition) throw new Error(`unknown legacy table ${entry.copyOf}`)
    const rows = rowsFor(entry.table, definition, entry.count, entry.copyOf)
    if (entry.table !== entry.copyOf) {
      // A dated copy keeps its own id sequence; one row, key 1.
      const pk = definition.primaryKey[0]
      const snapshot = rows[0]
      if (pk && snapshot) snapshot[pk] = raw(1)
    }
    assertKeyOrder(entry.table, definition, rows)
    blocks.push(renderTable(entry.table, definition, rows))
    tables.push({ table: entry.table, rows: rows.length })
  }

  blocks.push(DUMP_FOOTER)
  const dump = blocks.join('')
  const bytes = Buffer.from(dump, 'latin1')

  const manifest: FixtureManifest = {
    generatedAt: GENERATED_AT,
    source: 'synthetic',
    file: FIXTURE_FILE,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    tables,
    nastyCases: NASTY_CASES,
  }
  return { dump, bytes, manifest }
}

export function writeFixture(): BuiltFixture {
  const built = buildFixture()
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(DUMP_PATH, built.bytes)
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(built.manifest, null, 2)}\n`, 'utf8')
  return built
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  const built = writeFixture()
  const rowTotal = built.manifest.tables.reduce((sum, entry) => sum + entry.rows, 0)
  console.log(
    `wrote ${DUMP_PATH} (${built.manifest.sizeBytes} bytes, ${rowTotal} rows, sha256 ${built.manifest.sha256})`,
  )
  console.log(`wrote ${MANIFEST_PATH}`)
}

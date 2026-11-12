# Reports

The legacy report screens were fifteen near-identical PHP pages per client plus
separate stock, site-visit and work-order reports. CLS v2 keeps the report set
and replaces the copies with one parameterised query per family.

- **Client invoices**: the Bell, Telus/Koodo, TJX, TJX-PMA, TJX-Projects,
  easyHome, The Source, BBE, BDI, TBS, GoEasy and Mobile Klinik pages are one
  report with a `client` preset and `serviceScope` of `work` or `maintenance`.
- **Client outstanding work**: the same client presets over open work orders.
- **Work-order summary**: client rows with interior/exterior/maintenance/other
  and cancelled counts.
- **Site visits**: one row per site, with the number of work orders in the date
  range (legacy's `datetaken > '2016-12-31'` default is now a date filter).
- **Parts stock**: stock quantity and fixed-point cost/retail valuation.

All five are available at `/reports`. The page size defaults to **100**, the
legacy page size, and is configurable to 50, 100, 250 or 500. Page size is a
view setting; PDF and XLSX export every matching row up to 5,000.

## Money

Invoice figures are the posted totals on `app.sales_invoices`. The report does
not recalculate an issued invoice. Summary rows are accumulated with
`@cls/pricing` `add`/`money`, and parts valuation uses `multiply` on parsed
fixed-point values. No report performs floating-point money arithmetic.

## Parity anchors

The migration harness runs these statements before and after the legacy import.
The expected counts below are for the development database as of this module's
commit: `app`/`public` report source tables are empty there, so the client
reports return 0 and only the eight imported parts return rows. Re-run the same
statements on the production copy after import; the SQL, not the development
counts, is the anchor.

### 1. Client invoices — Bell, non-maintenance, 2026

Legacy source (`public.inv_hours` is the invoice-hours table, `public.workorder`
the work-order table):

```sql
SELECT COUNT(DISTINCT workorder.id)
FROM workorder, inv_hours
WHERE workorder.id = inv_hours.woid
  AND servicetype != 3
  AND status = 11
  AND inv_hours.date BETWEEN '2026-01-01' AND '2026-11-12'
  AND workorder.site IN (
    SELECT tcustshp.lId
    FROM tcustomr, tcustshp
    WHERE tcustomr.sName LIKE 'Bell Mobility Inc%'
      AND tcustshp.lCustId = tcustomr.lId
      AND tcustshp.sShipPrvSt = 'ON'
  );
```

New query (`app` tables; run with the same dates and a province filter):

```sql
SELECT COUNT(*)
FROM app.sales_invoices i
JOIN app.work_orders w ON w.id = i.work_order_id
JOIN app.sites s ON s.id = i.site_id
JOIN app.customers c ON c.id = s.customer_id
WHERE i.status IN ('issued', 'partially_paid', 'paid')
  AND w.service_type_id <> 3
  AND c.name ILIKE 'Bell Mobility Inc%'
  AND s.province = 'ON'
  AND EXISTS (
    SELECT 1
    FROM app.invoice_labour_lines l
    WHERE l.invoice_id = i.id
      AND l.line_date BETWEEN '2026-01-01' AND '2026-11-12'
  );
```

Expected: **0** rows in the development database for either statement.
`serviceScope = maintenance` flips `w.service_type_id <> 3` to `= 3`, matching
`reports_*_unpaidinv_maint.php`.

The new report treats `issued`, `partially_paid` and `paid` as invoiced. The
legacy `status = 11` means "Invoiced" and did not distinguish payment; payment
status is now shown as a column rather than being invented as a filter.

### 2. Client outstanding work — Bell

Legacy:

```sql
SELECT COUNT(*)
FROM workorder
WHERE status != 11
  AND site IN (
    SELECT tcustshp.lId
    FROM tcustomr, tcustshp
    WHERE tcustomr.sName LIKE 'Bell Mobility Inc%'
      AND tcustshp.lCustId = tcustomr.lId
  );
```

New:

```sql
SELECT COUNT(*)
FROM app.work_orders w
JOIN app.sites s ON s.id = w.site_id
JOIN app.customers c ON c.id = s.customer_id
WHERE w.status <> 11
  AND c.name ILIKE 'Bell Mobility Inc%';
```

Expected: **0** rows in the development database.

### 3. Work-order summary — Bell, 2026

Legacy `report_wos_print.php` counted work orders by client after the date,
province and service filters.

```sql
SELECT COUNT(DISTINCT c.id)
FROM app.work_orders w
JOIN app.sites s ON s.id = w.site_id
JOIN app.customers c ON c.id = s.customer_id
WHERE w.date_taken BETWEEN '2026-01-01' AND '2026-11-12'
  AND c.name ILIKE 'Bell Mobility Inc%';
```

Expected: **0** client rows in the development database.

### 4. Site visits — Bell

Legacy listed every site for the client, including sites with zero visits, and
counted work orders after 2016-12-31.

```sql
SELECT COUNT(*)
FROM app.sites s
JOIN app.customers c ON c.id = s.customer_id
WHERE c.name ILIKE 'Bell Mobility Inc%';
```

Expected: **0** site rows in the development database.

### 5. Parts stock

Legacy `report_parts_stock_output.php` reported purchased quantity and usage
per part/subcontractor. The v2 report keeps the stock half — current quantity,
unit cost, unit sell and fixed-point valuation — from `app.parts`.

```sql
SELECT COUNT(*) FROM app.parts;
SELECT COALESCE(SUM(current_quantity), 0)::text,
       COALESCE(SUM(current_quantity * COALESCE(cost, 0)), 0)::text,
       COALESCE(SUM(current_quantity * COALESCE(sell_price, 0)), 0)::text
FROM app.parts;
```

Expected at this commit: **8** parts. Quantities and valuations depend on the
eight imported parts; the integration test pins the arithmetic on its own
fixture (`6 × 2.50 = 15.00`, `6 × 4.00 = 24.00`).

## Exports

Both formats are generated from the same query as the screen.

- PDF: `@cls/pdf` kind `report` (`ReportDocument`), Letter portrait, columns
  share the body width and money is right-aligned. Metadata uses the report's
  generated date so a re-render of the same request is byte-identical.
- XLSX: ExcelJS, one sheet, filter line, frozen header and totals row. Numeric
  cells are written as numbers; dates and identifiers stay text.
- Every export writes `app.audit_log` action `report.export` with the filters,
  row count, truncation flag and format.

## Tests

`apps/web/src/modules/reports/server/reports.integration.test.ts` seeds a
customer, site, three work orders (invoiced/open/maintenance), an issued invoice
with a labour line and a part. It pins customer matching, date filtering, the
maintenance split, outstanding exclusion of invoiced work, grouped counts, site
visits, parts valuation, and the PDF/XLSX magic bytes plus audit rows. It runs
inside a transaction and rolls back; it creates no schema.

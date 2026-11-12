# Manifest coverage — the 77 tables classified after the first 98

`scripts/import/manifest.ts` now classifies every table in `legacy-schema.json`: 164 loaded in one of
the twelve groups, 11 out of scope, none unknown. `manifest.test.ts` fails if that stops being true.

Evidence is a read or write in the running PHP app (`/Users/gene/Projects/CLS-Green System/app`).
Dated and superseded copies (`* - 22mar24.php`, `*-27oct23.php`, `* 20OCT2025.php`,
`OneDrive_2026-07-05/`) are treated as retired and are not evidence on their own. `fixtureRows` is
0 throughout: the synthetic fixture is a case matrix and does not carry these tables.

## Live — added to the group its plan section names

| Table | Group | Evidence |
|---|---|---|
| `permission_type` | identity | `app/admin/site_permission._for_user.php:108` selects the grant list |
| `parts_sub_suppliers` | parts | `app/add_blank_preorder_request.php:914` select, `app/ajax_form_po_pending_approval.php:128` select |
| `parts_supplier_model_rates` | parts | `app/ajaxSavePurchaseOrder.php:2190`, `app/editpo.php:1638` cost lookup |
| `localwo_cusprofile` | work-orders | `app/tech/ecusprofile.php:13` insert, `:60` select; `app/tech/vcusprofile.php:51` select |
| `localwo_hours_change_histroy` | work-orders | `app/config/functions.php:4910` insert, `:4934` select |
| `localwo_quotes` | work-orders | `app/project_localwo.php:700` select, written by `app/tech/addquote_submit.php` |
| `localwo_sigs` | work-orders | `app/tech/sigcapture_submit.php:171` insert, `app/local_pdf.php:69` select |
| `material_checklist` | work-orders | `app/subcontractor/material_checklist.php:146` select, written by `ajaxSaveMaterialChecklist.php` |
| `material_checklist_custom_entries` | work-orders | `material_checklist.php:162` select, `ajaxSaveMaterialChecklist.php:393` insert |
| `material_checklist_defective_parts` | work-orders | `material_checklist.php:163` select, `ajaxSaveMaterialChecklist.php:581` insert |
| `material_checklist_notes` | work-orders | `material_checklist.php:256` select, `ajaxSaveMaterialChecklist.php:357` insert |
| `material_checklist_parts` | work-orders | `material_checklist.php:152` select, written by `ajaxSaveMaterialChecklist.php` |
| `material_checklist_returning_custom_enteries` | work-orders | `material_checklist.php:164` select, `ajaxSaveMaterialChecklist.php:528` insert |
| `material_checklist_returning_parts` | work-orders | `material_checklist.php:165` select, `ajaxSaveMaterialChecklist.php:474` insert |
| `undispatched_workorders` | work-orders | `app/undispatched_wos.php:144` select, `menu.php:25` links the page, written by `import_workorders.php` |
| `customer_quote_payterms` | quotes | `app/add_customer_qo.php` selects `id, name` for the payment-terms dropdown |
| `customer_qo_packing_soparts` | quotes | `app/add_customer_packing_slip_submit.php:117` insert, `app/view_customer_packing_slip.php:144` select |
| `calcquote_hours` | quotes | `app/calc.php:1585` select, `app/quotes_del.php:54` delete |
| `calcquote_hours_incurred` | quotes | `app/quotes_calc_submit.php:181` insert |
| `calcquote_incurred` | quotes | `app/quotes_calcinc_submit.php:156-162`, read by `app/send_quote_pdf_to_customer.php:302` |
| `calcquote_parts` | quotes | `app/quotes-edit-submit.php:138` insert, `app/send_sub_quote_pdf_to_customer.php:260` select |
| `calcquote_parts_incurred` | quotes | `app/quotes_calc_submit.php:112` insert, `app/send_quote_pdf_to_customer.php:270` select |
| `calcquote_report` | quotes | `app/quotes_new_submit.php:61` insert, `app/quotesm_incurred.php:41` select |
| `calcquote_soparts` | quotes | `app/quotesm_add.php:47` insert, `app/quotes-edit-submit.php:179` insert |
| `calcquote_soparts_incurred` | quotes | `app/quotes_calc_submit.php:151` insert, `app/send_quote_pdf_to_customer.php:272` select |
| `quote_hours` | quotes | `app/subcontractor/quotewo_submit.php:346` insert, `app/subcontractor/viewquote.php` select |
| `quote_hours_incurred` | quotes | `app/subcontractor/quotewo_submit.php:232` insert |
| `quote_parts` | quotes | `app/subcontractor/quotewo_submit.php:261` insert |
| `quote_parts_incurred` | quotes | `app/subcontractor/quotewo_submit.php:150` insert |
| `quote_report` | quotes | `app/subcontractor/quotewo_submit.php:120` insert |
| `quote_soparts` | quotes | `app/subcontractor/quotewo_submit.php:303` insert |
| `quote_soparts_incurred` | quotes | `app/subcontractor/quotewo_submit.php:188` insert, `app/quotes_calc.php:142` select |
| `po_quote_request_status` | purchasing | `app/config/functions.php:5546` selects the label |
| `po_quote_submitted_status` | purchasing | `app/preorders.php:251` selects the list, `app/config/functions.php:5536` |
| `po_quote_suppliers` | purchasing | `app/preorders.php:226` join over waiting RFQ responses |
| `po_quote_requested_parts_detail` | purchasing | `app/config/functions.php:5502` selects the requested part numbers |
| `po_supplier_quote` | purchasing | `app/preorders.php:231-238` lists submitted, approved and cancelled quotes |
| `po_supplier_quote_parts` | purchasing | `app/config/functions.php:5520` selects the quoted part numbers |
| `po_invoice_soparts` | purchasing | `app/po_invoice_pdf.php:149` select, `app/add_po_invoice_submit.php:114` delete/insert |
| `po_preorder_suppliers` | purchasing | `app/add_preorder_request_submit.php:281` insert, `app/ajaxSavePurchaseOrder.php:1161` |
| `po_submission_after_approval` | purchasing | `app/ajax_form_po_pending_approval.php:265` select, `app/ajax_form_po_challenged_or_approve_submit.php:636` update |
| `sc_inv_hours` | invoicing-rga | `app/calc_subprojectwo_submit.php:282` insert, `:75` delete |
| `sc_inv_parts` | invoicing-rga | `app/calc_subprojectwo_submit.php:192` insert, `:73` delete |
| `sc_inv_soparts` | invoicing-rga | `app/calc_subprojectwo_submit.php:248` insert, `:74` delete |
| `sc_inv_tax` | invoicing-rga | `app/calc_subprojectwo_submit.php:147` insert, `app/localpinvoice.php:413` select |
| `tjx_room` | tjx | `app/subcontractor/add_tjx_invoicewo.php:1159` select, `app/tjx_sub_invoice.php:299` select |
| `tjx_fixture` | tjx | `app/tjxpanel/fixtureparts.php:51` select, `app/tjxpanel/ajaxSaveFixturesOrder.php:26` update |
| `tjx_rooms_template` | tjx | `app/tjxpanel/rooms_template.php:177` select, `app/tjxpanel/ajaxSaveRoomTemplate.php:29` insert |
| `tjx_fixture_per_quote` | tjx | `app/subcontractor/add_tjx_invoicewo.php:1158` select |
| `tjx_fixture_parts_per_quote` | tjx | `app/tjxpanel/addfixture_perquote_submit.php:96` insert, `app/subcontractor/ajaxCalculateTJXinvoice.php:150` select |
| `tjx_quote_grid_types` | tjx | `app/tjxpanel/add_tjx_quote.php:257` select, `app/tjxpanel/view_tjxqo.php:133` select |
| `tjx_quote_payterms` | tjx | `app/tjxpanel/tjx_all_quotes.php:270` select, `app/tjxpanel/view_tjxqo.php:125` select |
| `tjx_prices_per_quote` | tjx | `app/tjxpanel/prices_perquote.php:71` select, `app/tjxpanel/ajaxSaveTJXquote.php:623` |
| `tjx_quote_parts` | tjx | `app/tjxpanel/ajaxSaveTJXquote.php:556` delete/insert |
| `tjx_quote_soparts` | tjx | `app/tjxpanel/ajaxSaveTJXquote.php:538` insert, `:525` delete |
| `tjx_quote_extra_workorders` | tjx | `app/subcontractor/admin_view_add_tjx_invoicewo.php:53` select |
| `tjx_quote_lastused_sharedpart` | tjx | `app/tjxpanel/add_tjx_quote.php:125` select, `app/tjxpanel/ajaxSaveTJXquote.php:559` delete |
| `tjx_quote_downloads` | tjx | `app/tjxpanel/ajax_form_quote_download_submit.php:108` insert, `app/tjxpanel/view_tjxqo.php:168` select |
| `tjx_sub_invoice_fixtures` | tjx | `app/subcontractor/add_tjx_invoicewo.php:306` select, `admin_view_add_tjx_invoicewo.php:225` |
| `tjx_sub_invoice_revisions` | tjx | `app/config/functions.php:5824` insert, `app/cron_delete_old_activity_logs.php:29` prunes |
| `tjx_wo_parts` | tjx | `app/subcontractor/add_tjx_invoicewo.php:312` select |
| `tjx_wo_soparts` | tjx | `app/subcontractor/ajaxSaveTJXinvoice.php:663` insert, `admin_view_add_tjx_invoicewo.php:226` select |
| `message_setup` | messaging-history | `app/admin/messaging_submit.php:43` update, `app/tech/checkin.php:25` select |
| `email_messages_to_sub` | messaging-history | `app/subcontractor/submailreply_submit.php:62` insert, `app/subcontractor/submailreply.php:45` select |
| `sub_stock_messages` | messaging-history | `app/cron_sub_stock.php:189` insert, `app/subcontractor/stockinfo_response_submit.php:49` update |
| `sub_stock_notification` | messaging-history | `app/cron_sub_stock.php:185` insert, `:45` select |

## Out of scope — 11 tables, with the reason they stay behind

| Table | Reason |
|---|---|
| `settings` | Curated row by row in `admin/settings.php` (`AllowPrevFiscalYear`, `allowed_sub_login_names`); plan §2.5 step 1 says configuration is entered by hand and never bulk-copied. |
| `servchannel_api_setting` | Settings-like key/value sheet for ServiceChannel credentials with zero reads and zero writes in the legacy app; the values are entered by hand after cutover, never copied. |
| `wo_ajax_submit` | Write-only form buffer: `wo_report_issue_submit.php:339` inserts the posted payload and no file ever selects it. |
| `undispatched_batch_upload` | Transient batch bookkeeping: `import_workorders.php:160` inserts a timestamp and nothing reads it; the rows it describes survive in `undispatched_workorders`. |
| `api_sc_callback_url_response` | Write-only timing log: `sc_api_1.php:19` inserts one row per callback and no file selects it. |
| `api_sc_status_webhook` | Write-only webhook payload log: `sc_api_hook_wo_status.php:86` inserts the raw hook body and nothing reads it back. |
| `api_sc_webhook` | Write-only webhook payload log: `sc_api_hook_checkin.php:76` inserts the raw hook body and nothing reads it back. |
| `errors_log_info` | Write-only breadcrumb: `config/functions.php:5238` inserts on a quote revision failure and no page or report reads it. |
| `rga_invoice` | No reference anywhere in the legacy PHP app; RGA supplier credits live in `rga`, `rga_parts` and `rga_soparts`. |
| `rga_invoice_parts` | No reference anywhere in the legacy PHP app; RGA credit lines live in `rga_parts`. |
| `rga_invoice_soparts` | No reference anywhere in the legacy PHP app; RGA special-part lines live in `rga_soparts`. |

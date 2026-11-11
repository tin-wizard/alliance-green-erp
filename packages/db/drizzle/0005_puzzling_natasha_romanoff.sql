CREATE TABLE "app"."purchase_order_approvals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"decision" text NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"po_version" integer NOT NULL,
	"self_approved" boolean DEFAULT false NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_approvals_decision_check" CHECK ("app"."purchase_order_approvals"."decision" in ('request','approve','challenge','cancel_request'))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_invoice_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"part_line_id" integer,
	"special_part_line_id" integer,
	"qty" numeric(12, 2) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"variance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"tax_code" text,
	"applied_tax_rate" numeric(9, 5),
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_hst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_gst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_pst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_tvp" numeric(14, 2) DEFAULT '0' NOT NULL,
	"freight" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"variance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"variance_detail" text,
	"accepted_variance_reason" text,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"sage_reference" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_invoices_status_check" CHECK ("app"."purchase_order_invoices"."status" in ('draft','pending_receipt','matched','posted','void'))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"description" text,
	"qty" numeric(12, 2) DEFAULT '0' NOT NULL,
	"qty_received" numeric(12, 2) DEFAULT '0' NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"model_number" text,
	"item_purchase_type" text,
	"item_purchase_type_number" text,
	"work_order_number" integer,
	"under_warranty" boolean DEFAULT false NOT NULL,
	"do_not_deduct_from" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_order_parts_qty_check" CHECK ("app"."purchase_order_parts"."qty" >= 0),
	CONSTRAINT "purchase_order_parts_received_check" CHECK ("app"."purchase_order_parts"."qty_received" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_preorder_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"preorder_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"qty" numeric(12, 2) NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"item_purchase_type" text,
	"item_purchase_type_number" text,
	"supplier_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_preorder_special_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"preorder_id" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(12, 2) NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"item_purchase_type" text,
	"item_purchase_type_number" text,
	"supplier_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_preorder_suppliers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"preorder_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"response_status" text DEFAULT 'waiting' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_preorder_suppliers_status_check" CHECK ("app"."purchase_order_preorder_suppliers"."response_status" in ('waiting','accepted','decline'))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_preorders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"source_quote_id" integer,
	"report" text,
	"priority_id" smallint,
	"notes" text,
	"is_without_quote" boolean DEFAULT false NOT NULL,
	"work_order_number" integer,
	"created_by" uuid,
	"date_received" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_preorders_status_check" CHECK ("app"."purchase_order_preorders"."status" in (1,2))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_receipt_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"part_line_id" integer,
	"special_part_line_id" integer,
	"qty" numeric(12, 2) NOT NULL,
	"over_received_qty" numeric(12, 2) DEFAULT '0' NOT NULL,
	"note" text,
	CONSTRAINT "purchase_order_receipt_lines_qty_check" CHECK ("app"."purchase_order_receipt_lines"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_receipts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"received_on" date DEFAULT now() NOT NULL,
	"received_by" uuid,
	"carrier" text,
	"tracking_id" text,
	"notes" text,
	"stock_posted_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_rfq_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"part_no" text,
	"name" text,
	"qty" numeric(12, 2) NOT NULL,
	"target_price" numeric(12, 2),
	"item_purchase_type" text,
	"item_purchase_type_number" text,
	"awarded_supplier_quote_id" integer,
	"awarded_po_id" integer,
	"cancelled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_rfq_suppliers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"response_status" text DEFAULT 'waiting' NOT NULL,
	"quotes_counter" integer DEFAULT 0 NOT NULL,
	"resubmission_request" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_rfq_suppliers_status_check" CHECK ("app"."purchase_order_rfq_suppliers"."response_status" in ('waiting','accepted','decline'))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_rfqs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"status" smallint DEFAULT 1 NOT NULL,
	"source_quote_id" integer,
	"report" text,
	"priority_id" smallint,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_rfqs_status_check" CHECK ("app"."purchase_order_rfqs"."status" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_special_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(12, 2) DEFAULT '0' NOT NULL,
	"qty_received" numeric(12, 2) DEFAULT '0' NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"model_number" text,
	"item_purchase_type" text,
	"item_purchase_type_number" text,
	"do_not_deduct_from" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_order_special_parts_qty_check" CHECK ("app"."purchase_order_special_parts"."qty" >= 0),
	CONSTRAINT "purchase_order_special_parts_received_check" CHECK ("app"."purchase_order_special_parts"."qty_received" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"from_status" smallint,
	"to_status" smallint NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"po_version" integer NOT NULL,
	"self_approved" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_supplier_quote_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_quote_id" integer NOT NULL,
	"rfq_line_id" integer NOT NULL,
	"part_no" text,
	"name" text,
	"qty" numeric(12, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_supplier_quotes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"status" smallint DEFAULT 3 NOT NULL,
	"expected_delivery" date,
	"notes" text,
	"processed_as_order" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_supplier_quotes_status_check" CHECK ("app"."purchase_order_supplier_quotes"."status" in (3,4,5))
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_orders" (
	"id" integer PRIMARY KEY NOT NULL,
	"display_number" text,
	"supplier_id" integer NOT NULL,
	"sub_supplier_id" integer,
	"status" smallint DEFAULT 3 NOT NULL,
	"legacy_status" smallint,
	"priority_id" smallint,
	"shipment_type" text DEFAULT '' NOT NULL,
	"ship_contact" text,
	"ship_company" text,
	"ship_street_1" text,
	"ship_street_2" text,
	"ship_city" text,
	"ship_province" text,
	"ship_postal_code" text,
	"ship_phone" text,
	"expected_delivery" date,
	"supplier_notes" text,
	"notes" text,
	"fob" text,
	"pay_terms" text,
	"ship_via" text,
	"tracking_id" text,
	"security_code" text,
	"tax_code" text,
	"applied_tax_rate" numeric(9, 5),
	"applied_tax_rate_pst" numeric(9, 5),
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"approval_request_by" uuid,
	"approval_requested_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_revision" integer,
	"self_approved" boolean DEFAULT false NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"po_submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"closed_short" boolean DEFAULT false NOT NULL,
	"short_close_reason" text,
	"stock_posted_at" timestamp with time zone,
	"source_quote_id" integer,
	"preorder_id" integer,
	"rfq_id" integer,
	"supplier_quote_id" integer,
	"work_order_number" integer,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"transfer_from_po_id" integer,
	"transfer_from_type" text,
	"transfer_from_customer_id" integer,
	"transfer_from_subcontractor_id" integer,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_check" CHECK ("app"."purchase_orders"."status" between 1 and 11)
);
--> statement-breakpoint
CREATE TABLE "app"."inventory_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"part_no" text NOT NULL,
	"qty" numeric(12, 2) NOT NULL,
	"movement_type" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"po_id" integer,
	"receipt_id" integer,
	"receipt_line_id" integer,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_type_check" CHECK ("app"."inventory_movements"."movement_type" in ('purchase_receipt','transfer_out','transfer_in'))
);
--> statement-breakpoint
ALTER TABLE "app"."purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_invoice_lines" ADD CONSTRAINT "purchase_order_invoice_lines_invoice_id_purchase_order_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."purchase_order_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_invoice_lines" ADD CONSTRAINT "purchase_order_invoice_lines_part_line_id_purchase_order_parts_id_fk" FOREIGN KEY ("part_line_id") REFERENCES "app"."purchase_order_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_invoice_lines" ADD CONSTRAINT "purchase_order_invoice_lines_special_part_line_id_purchase_order_special_parts_id_fk" FOREIGN KEY ("special_part_line_id") REFERENCES "app"."purchase_order_special_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_invoices" ADD CONSTRAINT "purchase_order_invoices_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_parts" ADD CONSTRAINT "purchase_order_parts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_preorder_parts" ADD CONSTRAINT "purchase_order_preorder_parts_preorder_id_purchase_order_preorders_id_fk" FOREIGN KEY ("preorder_id") REFERENCES "app"."purchase_order_preorders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_preorder_special_parts" ADD CONSTRAINT "purchase_order_preorder_special_parts_preorder_id_purchase_order_preorders_id_fk" FOREIGN KEY ("preorder_id") REFERENCES "app"."purchase_order_preorders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_preorder_suppliers" ADD CONSTRAINT "purchase_order_preorder_suppliers_preorder_id_purchase_order_preorders_id_fk" FOREIGN KEY ("preorder_id") REFERENCES "app"."purchase_order_preorders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_receipt_lines" ADD CONSTRAINT "purchase_order_receipt_lines_receipt_id_purchase_order_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."purchase_order_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_receipt_lines" ADD CONSTRAINT "purchase_order_receipt_lines_part_line_id_purchase_order_parts_id_fk" FOREIGN KEY ("part_line_id") REFERENCES "app"."purchase_order_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_receipt_lines" ADD CONSTRAINT "purchase_order_receipt_lines_special_part_line_id_purchase_order_special_parts_id_fk" FOREIGN KEY ("special_part_line_id") REFERENCES "app"."purchase_order_special_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_receipts" ADD CONSTRAINT "purchase_order_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_rfq_lines" ADD CONSTRAINT "purchase_order_rfq_lines_rfq_id_purchase_order_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "app"."purchase_order_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_rfq_suppliers" ADD CONSTRAINT "purchase_order_rfq_suppliers_rfq_id_purchase_order_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "app"."purchase_order_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_special_parts" ADD CONSTRAINT "purchase_order_special_parts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_status_history" ADD CONSTRAINT "purchase_order_status_history_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_supplier_quote_lines" ADD CONSTRAINT "purchase_order_supplier_quote_lines_supplier_quote_id_purchase_order_supplier_quotes_id_fk" FOREIGN KEY ("supplier_quote_id") REFERENCES "app"."purchase_order_supplier_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_supplier_quote_lines" ADD CONSTRAINT "purchase_order_supplier_quote_lines_rfq_line_id_purchase_order_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "app"."purchase_order_rfq_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_supplier_quotes" ADD CONSTRAINT "purchase_order_supplier_quotes_rfq_id_purchase_order_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "app"."purchase_order_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_approvals_po_idx" ON "app"."purchase_order_approvals" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "purchase_order_invoice_lines_invoice_idx" ON "app"."purchase_order_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_invoices_supplier_number_unique" ON "app"."purchase_order_invoices" USING btree ("supplier_id","supplier_invoice_number");--> statement-breakpoint
CREATE INDEX "purchase_order_invoices_po_idx" ON "app"."purchase_order_invoices" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "purchase_order_parts_po_idx" ON "app"."purchase_order_parts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "purchase_order_preorder_parts_idx" ON "app"."purchase_order_preorder_parts" USING btree ("preorder_id");--> statement-breakpoint
CREATE INDEX "purchase_order_preorder_special_parts_idx" ON "app"."purchase_order_preorder_special_parts" USING btree ("preorder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_preorder_suppliers_unique" ON "app"."purchase_order_preorder_suppliers" USING btree ("preorder_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_order_receipt_lines_receipt_idx" ON "app"."purchase_order_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_receipts_idempotency_unique" ON "app"."purchase_order_receipts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "purchase_order_receipts_po_idx" ON "app"."purchase_order_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "purchase_order_rfq_lines_rfq_idx" ON "app"."purchase_order_rfq_lines" USING btree ("rfq_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_rfq_suppliers_unique" ON "app"."purchase_order_rfq_suppliers" USING btree ("rfq_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_order_special_parts_po_idx" ON "app"."purchase_order_special_parts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "purchase_order_status_history_po_idx" ON "app"."purchase_order_status_history" USING btree ("po_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_order_supplier_quote_lines_quote_idx" ON "app"."purchase_order_supplier_quote_lines" USING btree ("supplier_quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_supplier_quote_lines_unique" ON "app"."purchase_order_supplier_quote_lines" USING btree ("supplier_quote_id","rfq_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_supplier_quotes_unique" ON "app"."purchase_order_supplier_quotes" USING btree ("rfq_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_display_number_unique" ON "app"."purchase_orders" USING btree ("display_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "app"."purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "app"."purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_orders_created_idx" ON "app"."purchase_orders" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_idempotency_unique" ON "app"."inventory_movements" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "inventory_movements_part_idx" ON "app"."inventory_movements" USING btree ("part_no");--> statement-breakpoint
CREATE INDEX "inventory_movements_receipt_idx" ON "app"."inventory_movements" USING btree ("receipt_id");

-- D17: purchase-order approval and issue are capability grants, not username
-- checks. Every admin receives both; the widening is deliberate.
INSERT INTO "app"."role_permissions" ("role", "permission_key") VALUES
  ('admin', 'po.approve'),
  ('admin', 'po.issue')
ON CONFLICT DO NOTHING;

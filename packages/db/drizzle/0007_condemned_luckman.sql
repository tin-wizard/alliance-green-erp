CREATE TABLE "app"."invoice_labour_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"line_date" date NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"rate_code" smallint DEFAULT 1 NOT NULL,
	"hourly_rate" numeric(9, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."invoice_part_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"part_no" text NOT NULL,
	"is_local_part" boolean DEFAULT false NOT NULL,
	"applied_work_order_id" text
);
--> statement-breakpoint
CREATE TABLE "app"."invoice_payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" date DEFAULT current_date NOT NULL,
	"method" text,
	"reference" text,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_amount_check" CHECK ("app"."invoice_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."invoice_special_part_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"name" text NOT NULL,
	"is_emergency_lighting" boolean DEFAULT false NOT NULL,
	"is_local_part" boolean DEFAULT false NOT NULL,
	"warranty_years" text,
	"labor_warranty_years" text,
	"applied_work_order_id" text
);
--> statement-breakpoint
CREATE TABLE "app"."invoice_stock_postings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"reference" text NOT NULL,
	"movement_count" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "invoice_stock_postings_status_check" CHECK ("app"."invoice_stock_postings"."status" in ('posted','reversed'))
);
--> statement-breakpoint
CREATE TABLE "app"."rejected_invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"invoice_number" text NOT NULL,
	"rejected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"rejected_by_detail" text,
	"invoice_content" jsonb NOT NULL,
	"resubmitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."sage_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" integer NOT NULL,
	"external_ref" text NOT NULL,
	"external_id" text NOT NULL,
	"payload_hash" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sage_postings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" integer NOT NULL,
	"external_ref" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"response" jsonb,
	"last_error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sage_postings_status_check" CHECK ("app"."sage_postings"."status" in ('queued','processing','sent','unknown','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."sales_invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"work_order_number" integer NOT NULL,
	"customer_id" integer,
	"site_id" integer NOT NULL,
	"calc_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_date" date DEFAULT current_date NOT NULL,
	"due_date" date,
	"issued_on" date,
	"tax_province" text DEFAULT 'ON' NOT NULL,
	"applied_tax_rate" numeric(9, 5),
	"applied_tax_rate_pst" numeric(9, 5),
	"labour_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"material_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subtotal_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"manual_tax_amount" numeric(12, 2),
	"manual_subtotal_amount" numeric(12, 2),
	"legacy_cent_correction_applied" boolean DEFAULT false NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"issued_at" timestamp with time zone,
	"last_rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoices_status_check" CHECK ("app"."sales_invoices"."status" in ('draft','issued','rejected','partially_paid','paid','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractor_invoice_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source_line_id" integer,
	CONSTRAINT "subcontractor_invoice_lines_kind_check" CHECK ("app"."subcontractor_invoice_lines"."kind" in ('labour','part','special'))
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractor_invoice_payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" date DEFAULT current_date NOT NULL,
	"method" text,
	"reference" text,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subcontractor_invoice_payments_amount_check" CHECK ("app"."subcontractor_invoice_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractor_invoices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"subcontractor_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"tax_province" text DEFAULT 'ON' NOT NULL,
	"applied_tax_rate" numeric(9, 5),
	"applied_tax_rate_pst" numeric(9, 5),
	"labour_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"material_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subtotal_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"rejection_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subcontractor_invoices_status_check" CHECK ("app"."subcontractor_invoices"."status" in ('submitted','approved','rejected','partially_paid','paid','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "app"."invoice_labour_lines" ADD CONSTRAINT "invoice_labour_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoice_part_lines" ADD CONSTRAINT "invoice_part_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoice_special_part_lines" ADD CONSTRAINT "invoice_special_part_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoice_stock_postings" ADD CONSTRAINT "invoice_stock_postings_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rejected_invoices" ADD CONSTRAINT "rejected_invoices_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sales_invoices" ADD CONSTRAINT "sales_invoices_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_invoice_lines" ADD CONSTRAINT "subcontractor_invoice_lines_invoice_id_subcontractor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."subcontractor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_invoice_payments" ADD CONSTRAINT "subcontractor_invoice_payments_invoice_id_subcontractor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."subcontractor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_invoices" ADD CONSTRAINT "subcontractor_invoices_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_labour_lines_invoice_idx" ON "app"."invoice_labour_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_part_lines_invoice_idx" ON "app"."invoice_part_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_idempotency_unique" ON "app"."invoice_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "app"."invoice_payments" USING btree ("invoice_id","paid_on");--> statement-breakpoint
CREATE INDEX "invoice_special_part_lines_invoice_idx" ON "app"."invoice_special_part_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_stock_postings_invoice_unique" ON "app"."invoice_stock_postings" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "rejected_invoices_invoice_idx" ON "app"."rejected_invoices" USING btree ("invoice_id","rejected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sage_links_external_ref_unique" ON "app"."sage_links" USING btree ("external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "sage_links_document_unique" ON "app"."sage_links" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sage_postings_external_ref_unique" ON "app"."sage_postings" USING btree ("external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "sage_postings_document_unique" ON "app"."sage_postings" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "sage_postings_status_idx" ON "app"."sage_postings" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_work_order_unique" ON "app"."sales_invoices" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_number_unique" ON "app"."sales_invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "sales_invoices_status_idx" ON "app"."sales_invoices" USING btree ("status","invoice_date");--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "app"."sales_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subcontractor_invoice_lines_invoice_idx" ON "app"."subcontractor_invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontractor_invoice_payments_idempotency_unique" ON "app"."subcontractor_invoice_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "subcontractor_invoice_payments_invoice_idx" ON "app"."subcontractor_invoice_payments" USING btree ("invoice_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontractor_invoices_number_unique" ON "app"."subcontractor_invoices" USING btree ("subcontractor_id","invoice_number");--> statement-breakpoint
CREATE INDEX "subcontractor_invoices_status_idx" ON "app"."subcontractor_invoices" USING btree ("status","invoice_date");--> statement-breakpoint
CREATE INDEX "subcontractor_invoices_sub_idx" ON "app"."subcontractor_invoices" USING btree ("subcontractor_id","created_at");--> statement-breakpoint
CREATE INDEX "subcontractor_invoices_wo_idx" ON "app"."subcontractor_invoices" USING btree ("work_order_id");
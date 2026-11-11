CREATE TABLE "app"."tjx_fixture_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"fixture_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"part_type" text DEFAULT '' NOT NULL,
	"markup" numeric(12, 4) DEFAULT '1' NOT NULL,
	"ratio_per_fixture" numeric(12, 4) DEFAULT '1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tjx_fixture_parts_part_type_check" CHECK ("app"."tjx_fixture_parts"."part_type" in ('Ballast','Lamp','')),
	CONSTRAINT "tjx_fixture_parts_markup_check" CHECK ("app"."tjx_fixture_parts"."markup" > 0),
	CONSTRAINT "tjx_fixture_parts_ratio_check" CHECK ("app"."tjx_fixture_parts"."ratio_per_fixture" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_fixture_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_fixture_id" integer NOT NULL,
	"fixture_part_id" integer,
	"part_no" text NOT NULL,
	"part_type" text DEFAULT '' NOT NULL,
	"markup" numeric(12, 4) NOT NULL,
	"ratio_per_fixture" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tjx_quote_fixture_parts_markup_check" CHECK ("app"."tjx_quote_fixture_parts"."markup" > 0),
	CONSTRAINT "tjx_quote_fixture_parts_ratio_check" CHECK ("app"."tjx_quote_fixture_parts"."ratio_per_fixture" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"quote_room_id" integer NOT NULL,
	"fixture_id" integer,
	"fixture_name" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tjx_quote_fixtures_qty_check" CHECK ("app"."tjx_quote_fixtures"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"description" text,
	"qty_with_markup" numeric(12, 3) NOT NULL,
	"qty_without_markup" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_subtotal" numeric(14, 2) NOT NULL,
	"line_subtotal_without_markup" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'calculated' NOT NULL,
	CONSTRAINT "tjx_quote_parts_qty_check" CHECK ("app"."tjx_quote_parts"."qty_with_markup" >= 0 and "app"."tjx_quote_parts"."qty_without_markup" >= 0),
	CONSTRAINT "tjx_quote_parts_origin_check" CHECK ("app"."tjx_quote_parts"."origin" in ('calculated','legacy'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"previous_price" numeric(12, 2),
	"source" text DEFAULT 'snapshot' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tjx_quote_prices_price_check" CHECK ("app"."tjx_quote_prices"."price" >= 0),
	CONSTRAINT "tjx_quote_prices_source_check" CHECK ("app"."tjx_quote_prices"."source" in ('snapshot','override','imported'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"save_seq" integer NOT NULL,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"revision_type" text NOT NULL,
	"revised_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_quote" jsonb NOT NULL,
	"data_rooms" jsonb NOT NULL,
	"data_fixtures" jsonb NOT NULL,
	"data_parts" jsonb NOT NULL,
	"data_special_parts" jsonb NOT NULL,
	"notes" text,
	CONSTRAINT "tjx_quote_revisions_type_check" CHECK ("app"."tjx_quote_revisions"."revision_type" in ('insert','update','submit','approve','cancel','refresh_prices','email','import'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"room_id" integer,
	"room_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_special_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_subtotal" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tjx_quote_special_parts_qty_check" CHECK ("app"."tjx_quote_special_parts"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quote_work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"work_order_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"site_id" integer,
	"customer_id" integer,
	"status" smallint DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"quote_type" text DEFAULT 'Gen 1' NOT NULL,
	"ceiling_grid_type" smallint,
	"is_type_maintenance" boolean DEFAULT false NOT NULL,
	"payment_terms_code" smallint,
	"due_date" date,
	"ship_to_type" text,
	"ship_contact_name" text,
	"ship_company" text,
	"ship_street_1" text,
	"ship_street_2" text,
	"ship_city" text,
	"ship_province" text,
	"ship_postal_code" text,
	"ship_phone" text,
	"shipping_address" text,
	"tax_code" text,
	"tax_province" text,
	"applied_tax_rate" numeric(9, 5),
	"subtotal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"without_markup_subtotal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"without_markup_tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"without_markup_total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"pdf_notes" text,
	"revision_notes" text,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tjx_quotes_status_check" CHECK ("app"."tjx_quotes"."status" in (1,3,4,5)),
	CONSTRAINT "tjx_quotes_grid_check" CHECK ("app"."tjx_quotes"."ceiling_grid_type" is null or "app"."tjx_quotes"."ceiling_grid_type" in (1,2,3,4)),
	CONSTRAINT "tjx_quotes_payterms_check" CHECK ("app"."tjx_quotes"."payment_terms_code" is null or "app"."tjx_quotes"."payment_terms_code" in (1,3,4,5)),
	CONSTRAINT "tjx_quotes_tax_rate_check" CHECK ("app"."tjx_quotes"."applied_tax_rate" is null or ("app"."tjx_quotes"."applied_tax_rate" >= 0 and "app"."tjx_quotes"."applied_tax_rate" <= 1)),
	CONSTRAINT "tjx_quotes_totals_check" CHECK ("app"."tjx_quotes"."subtotal_amount" >= 0 and "app"."tjx_quotes"."tax_amount" >= 0 and "app"."tjx_quotes"."total_amount" >= 0 and "app"."tjx_quotes"."without_markup_subtotal_amount" >= 0 and "app"."tjx_quotes"."without_markup_tax_amount" >= 0 and "app"."tjx_quotes"."without_markup_total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_room_template_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_room_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_sub_invoice_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub_invoice_id" integer NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tjx_sub_invoice_documents_kind_check" CHECK ("app"."tjx_sub_invoice_documents"."kind" in ('post_project_fc_reading','post_project_photos','signed_work_order'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_sub_invoice_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub_invoice_id" integer NOT NULL,
	"quote_fixture_id" integer,
	"room_name" text NOT NULL,
	"fixture_name" text NOT NULL,
	"quoted_quantity" numeric(12, 3) NOT NULL,
	"installed_quantity" numeric(12, 3) NOT NULL,
	"discrepancy_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tjx_sub_invoice_fixtures_qty_check" CHECK ("app"."tjx_sub_invoice_fixtures"."quoted_quantity" >= 0 and "app"."tjx_sub_invoice_fixtures"."installed_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_sub_invoice_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub_invoice_id" integer NOT NULL,
	"quote_part_id" integer,
	"part_no" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_rate" numeric(12, 2) NOT NULL,
	"line_subtotal" numeric(14, 2) NOT NULL,
	"rate_source" text DEFAULT 'quoted_part' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tjx_sub_invoice_parts_qty_check" CHECK ("app"."tjx_sub_invoice_parts"."quantity" >= 0),
	CONSTRAINT "tjx_sub_invoice_parts_rate_check" CHECK ("app"."tjx_sub_invoice_parts"."unit_rate" >= 0),
	CONSTRAINT "tjx_sub_invoice_parts_source_check" CHECK ("app"."tjx_sub_invoice_parts"."rate_source" in ('quoted_part','fixture_part','imported'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_sub_invoice_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub_invoice_id" integer NOT NULL,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"revision_type" text NOT NULL,
	"revised_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_invoice" jsonb NOT NULL,
	"data_fixtures" jsonb NOT NULL,
	"data_parts" jsonb NOT NULL,
	CONSTRAINT "tjx_sub_invoice_revisions_type_check" CHECK ("app"."tjx_sub_invoice_revisions"."revision_type" in ('insert','update','submit','reject','approve','import'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_sub_invoice_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sub_invoice_id" integer NOT NULL,
	"revision_no" integer NOT NULL,
	"subcontractor_invoice_id" bigint,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text DEFAULT 'submitted' NOT NULL,
	"rejection_reason" text,
	CONSTRAINT "tjx_sub_invoice_submissions_outcome_check" CHECK ("app"."tjx_sub_invoice_submissions"."outcome" in ('submitted','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_sub_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"quote_id" integer NOT NULL,
	"work_order_id" integer NOT NULL,
	"subcontractor_id" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date NOT NULL,
	"tax_code" text,
	"tax_province" text,
	"applied_tax_rate" numeric(9, 5),
	"subtotal_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_gst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_pst" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"sub_notes" text,
	"chk_project_reading" boolean DEFAULT false NOT NULL,
	"chk_project_photos" boolean DEFAULT false NOT NULL,
	"chk_project_signoff" boolean DEFAULT false NOT NULL,
	"is_submitted" boolean DEFAULT false NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"subcontractor_invoice_id" bigint,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tjx_sub_invoices_totals_check" CHECK ("app"."tjx_sub_invoices"."subtotal_amount" >= 0 and "app"."tjx_sub_invoices"."tax_amount" >= 0 and "app"."tjx_sub_invoices"."tax_gst" >= 0 and "app"."tjx_sub_invoices"."tax_pst" >= 0 and "app"."tjx_sub_invoices"."total_amount" >= 0),
	CONSTRAINT "tjx_sub_invoices_rejected_check" CHECK ("app"."tjx_sub_invoices"."rejected_count" >= 0),
	CONSTRAINT "tjx_sub_invoices_tax_rate_check" CHECK ("app"."tjx_sub_invoices"."applied_tax_rate" is null or ("app"."tjx_sub_invoices"."applied_tax_rate" >= 0 and "app"."tjx_sub_invoices"."applied_tax_rate" <= 1))
);
--> statement-breakpoint
CREATE TABLE "app"."tjx_subcontractor_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"subcontractor_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"install_cost_per_unit" numeric(12, 2) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tjx_rates_cost_check" CHECK ("app"."tjx_subcontractor_rates"."install_cost_per_unit" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."tjx_fixture_parts" ADD CONSTRAINT "tjx_fixture_parts_fixture_id_tjx_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "app"."tjx_fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_fixture_parts" ADD CONSTRAINT "tjx_quote_fixture_parts_quote_fixture_id_tjx_quote_fixtures_id_fk" FOREIGN KEY ("quote_fixture_id") REFERENCES "app"."tjx_quote_fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_fixture_parts" ADD CONSTRAINT "tjx_quote_fixture_parts_fixture_part_id_tjx_fixture_parts_id_fk" FOREIGN KEY ("fixture_part_id") REFERENCES "app"."tjx_fixture_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_fixtures" ADD CONSTRAINT "tjx_quote_fixtures_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_fixtures" ADD CONSTRAINT "tjx_quote_fixtures_quote_room_id_tjx_quote_rooms_id_fk" FOREIGN KEY ("quote_room_id") REFERENCES "app"."tjx_quote_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_fixtures" ADD CONSTRAINT "tjx_quote_fixtures_fixture_id_tjx_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "app"."tjx_fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_parts" ADD CONSTRAINT "tjx_quote_parts_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_prices" ADD CONSTRAINT "tjx_quote_prices_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_revisions" ADD CONSTRAINT "tjx_quote_revisions_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_rooms" ADD CONSTRAINT "tjx_quote_rooms_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_rooms" ADD CONSTRAINT "tjx_quote_rooms_room_id_tjx_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."tjx_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_special_parts" ADD CONSTRAINT "tjx_quote_special_parts_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_work_orders" ADD CONSTRAINT "tjx_quote_work_orders_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quote_work_orders" ADD CONSTRAINT "tjx_quote_work_orders_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_quotes" ADD CONSTRAINT "tjx_quotes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_room_template_rooms" ADD CONSTRAINT "tjx_room_template_rooms_template_id_tjx_room_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."tjx_room_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_room_template_rooms" ADD CONSTRAINT "tjx_room_template_rooms_room_id_tjx_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."tjx_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_documents" ADD CONSTRAINT "tjx_sub_invoice_documents_sub_invoice_id_tjx_sub_invoices_id_fk" FOREIGN KEY ("sub_invoice_id") REFERENCES "app"."tjx_sub_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_documents" ADD CONSTRAINT "tjx_sub_invoice_documents_document_id_work_order_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."work_order_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_fixtures" ADD CONSTRAINT "tjx_sub_invoice_fixtures_sub_invoice_id_tjx_sub_invoices_id_fk" FOREIGN KEY ("sub_invoice_id") REFERENCES "app"."tjx_sub_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_fixtures" ADD CONSTRAINT "tjx_sub_invoice_fixtures_quote_fixture_id_tjx_quote_fixtures_id_fk" FOREIGN KEY ("quote_fixture_id") REFERENCES "app"."tjx_quote_fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_parts" ADD CONSTRAINT "tjx_sub_invoice_parts_sub_invoice_id_tjx_sub_invoices_id_fk" FOREIGN KEY ("sub_invoice_id") REFERENCES "app"."tjx_sub_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_parts" ADD CONSTRAINT "tjx_sub_invoice_parts_quote_part_id_tjx_quote_parts_id_fk" FOREIGN KEY ("quote_part_id") REFERENCES "app"."tjx_quote_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_revisions" ADD CONSTRAINT "tjx_sub_invoice_revisions_sub_invoice_id_tjx_sub_invoices_id_fk" FOREIGN KEY ("sub_invoice_id") REFERENCES "app"."tjx_sub_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_submissions" ADD CONSTRAINT "tjx_sub_invoice_submissions_sub_invoice_id_tjx_sub_invoices_id_fk" FOREIGN KEY ("sub_invoice_id") REFERENCES "app"."tjx_sub_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoice_submissions" ADD CONSTRAINT "tjx_sub_invoice_submissions_subcontractor_invoice_id_subcontractor_invoices_id_fk" FOREIGN KEY ("subcontractor_invoice_id") REFERENCES "app"."subcontractor_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoices" ADD CONSTRAINT "tjx_sub_invoices_quote_id_tjx_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."tjx_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoices" ADD CONSTRAINT "tjx_sub_invoices_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoices" ADD CONSTRAINT "tjx_sub_invoices_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_sub_invoices" ADD CONSTRAINT "tjx_sub_invoices_subcontractor_invoice_id_subcontractor_invoices_id_fk" FOREIGN KEY ("subcontractor_invoice_id") REFERENCES "app"."subcontractor_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tjx_subcontractor_rates" ADD CONSTRAINT "tjx_subcontractor_rates_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_fixture_parts_fixture_part_unique" ON "app"."tjx_fixture_parts" USING btree ("fixture_id","part_no");--> statement-breakpoint
CREATE INDEX "tjx_fixture_parts_fixture_idx" ON "app"."tjx_fixture_parts" USING btree ("fixture_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_fixture_parts_part_idx" ON "app"."tjx_fixture_parts" USING btree ("part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_fixtures_name_unique" ON "app"."tjx_fixtures" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_fixtures_legacy_unique" ON "app"."tjx_fixtures" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "tjx_fixtures_active_idx" ON "app"."tjx_fixtures" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_fixture_parts_unique" ON "app"."tjx_quote_fixture_parts" USING btree ("quote_fixture_id","part_no");--> statement-breakpoint
CREATE INDEX "tjx_quote_fixture_parts_fixture_idx" ON "app"."tjx_quote_fixture_parts" USING btree ("quote_fixture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_fixtures_order_unique" ON "app"."tjx_quote_fixtures" USING btree ("quote_room_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_quote_fixtures_quote_idx" ON "app"."tjx_quote_fixtures" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_parts_quote_part_unique" ON "app"."tjx_quote_parts" USING btree ("quote_id","part_no");--> statement-breakpoint
CREATE INDEX "tjx_quote_parts_quote_idx" ON "app"."tjx_quote_parts" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_quote_parts_part_idx" ON "app"."tjx_quote_parts" USING btree ("part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_prices_quote_part_unique" ON "app"."tjx_quote_prices" USING btree ("quote_id","part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_revisions_quote_seq_unique" ON "app"."tjx_quote_revisions" USING btree ("quote_id","save_seq");--> statement-breakpoint
CREATE INDEX "tjx_quote_revisions_quote_idx" ON "app"."tjx_quote_revisions" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_rooms_order_unique" ON "app"."tjx_quote_rooms" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_quote_rooms_quote_idx" ON "app"."tjx_quote_rooms" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "tjx_quote_special_parts_quote_idx" ON "app"."tjx_quote_special_parts" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_wos_quote_wo_unique" ON "app"."tjx_quote_work_orders" USING btree ("quote_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quote_wos_primary_unique" ON "app"."tjx_quote_work_orders" USING btree ("quote_id") WHERE "app"."tjx_quote_work_orders"."is_primary";--> statement-breakpoint
CREATE INDEX "tjx_quote_wos_wo_idx" ON "app"."tjx_quote_work_orders" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_quotes_legacy_unique" ON "app"."tjx_quotes" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "tjx_quotes_status_updated_idx" ON "app"."tjx_quotes" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "tjx_quotes_site_idx" ON "app"."tjx_quotes" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "tjx_quotes_customer_idx" ON "app"."tjx_quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_room_template_rooms_unique" ON "app"."tjx_room_template_rooms" USING btree ("template_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_room_template_rooms_order_unique" ON "app"."tjx_room_template_rooms" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_room_template_rooms_room_idx" ON "app"."tjx_room_template_rooms" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_room_templates_name_unique" ON "app"."tjx_room_templates" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_room_templates_default_unique" ON "app"."tjx_room_templates" USING btree ("is_default") WHERE "app"."tjx_room_templates"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_rooms_name_unique" ON "app"."tjx_rooms" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_rooms_legacy_unique" ON "app"."tjx_rooms" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "tjx_rooms_active_idx" ON "app"."tjx_rooms" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_sub_invoice_documents_unique" ON "app"."tjx_sub_invoice_documents" USING btree ("sub_invoice_id","kind","document_id");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoice_documents_invoice_idx" ON "app"."tjx_sub_invoice_documents" USING btree ("sub_invoice_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_sub_invoice_fixtures_order_unique" ON "app"."tjx_sub_invoice_fixtures" USING btree ("sub_invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoice_fixtures_invoice_idx" ON "app"."tjx_sub_invoice_fixtures" USING btree ("sub_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_sub_invoice_parts_invoice_part_unique" ON "app"."tjx_sub_invoice_parts" USING btree ("sub_invoice_id","part_no");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoice_parts_invoice_idx" ON "app"."tjx_sub_invoice_parts" USING btree ("sub_invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoice_revisions_invoice_idx" ON "app"."tjx_sub_invoice_revisions" USING btree ("sub_invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_sub_invoice_submissions_unique" ON "app"."tjx_sub_invoice_submissions" USING btree ("sub_invoice_id","revision_no");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoice_submissions_invoice_idx" ON "app"."tjx_sub_invoice_submissions" USING btree ("sub_invoice_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_sub_invoices_wo_number_unique" ON "app"."tjx_sub_invoices" USING btree ("work_order_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_sub_invoices_legacy_unique" ON "app"."tjx_sub_invoices" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoices_quote_idx" ON "app"."tjx_sub_invoices" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "tjx_sub_invoices_sub_idx" ON "app"."tjx_sub_invoices" USING btree ("subcontractor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_rates_sub_part_unique" ON "app"."tjx_subcontractor_rates" USING btree ("subcontractor_id","part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tjx_rates_legacy_unique" ON "app"."tjx_subcontractor_rates" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "tjx_rates_sub_idx" ON "app"."tjx_subcontractor_rates" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "tjx_rates_part_idx" ON "app"."tjx_subcontractor_rates" USING btree ("part_no");--> statement-breakpoint
INSERT INTO "app"."tjx_room_templates" ("name", "is_default")
VALUES ('Default Room Template', true)
ON CONFLICT DO NOTHING;
CREATE TABLE "app"."bell_fixture_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"fixture_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"part_type" text DEFAULT '' NOT NULL,
	"markup" numeric(12, 4) DEFAULT '1' NOT NULL,
	"ratio_per_fixture" numeric(12, 4) DEFAULT '1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bell_fixture_parts_part_type_check" CHECK ("app"."bell_fixture_parts"."part_type" in ('Ballast','Lamp','')),
	CONSTRAINT "bell_fixture_parts_markup_check" CHECK ("app"."bell_fixture_parts"."markup" > 0),
	CONSTRAINT "bell_fixture_parts_ratio_check" CHECK ("app"."bell_fixture_parts"."ratio_per_fixture" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bell_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."bell_foot_candle_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"fr_reading" text,
	"fc_reading" text,
	"fl_reading" text,
	"cr_reading" text,
	"c_reading" text,
	"cl_reading" text,
	"br_reading" text,
	"bc_reading" text,
	"bl_reading" text,
	"ftr_reading" text,
	"ftr_stall_reading" text
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"folder_name" text,
	"downloaded_by_name" text,
	"revision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_fixture_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_fixture_id" integer NOT NULL,
	"fixture_part_id" integer,
	"part_no" text NOT NULL,
	"part_type" text DEFAULT '' NOT NULL,
	"markup" numeric(12, 4) NOT NULL,
	"ratio_per_fixture" numeric(12, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bell_quote_fixture_parts_markup_check" CHECK ("app"."bell_quote_fixture_parts"."markup" > 0),
	CONSTRAINT "bell_quote_fixture_parts_ratio_check" CHECK ("app"."bell_quote_fixture_parts"."ratio_per_fixture" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"quote_room_id" integer NOT NULL,
	"fixture_id" integer,
	"fixture_name" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"gallery_folder_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bell_quote_fixtures_qty_check" CHECK ("app"."bell_quote_fixtures"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_parts" (
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
	CONSTRAINT "bell_quote_parts_qty_check" CHECK ("app"."bell_quote_parts"."qty_with_markup" >= 0 and "app"."bell_quote_parts"."qty_without_markup" >= 0),
	CONSTRAINT "bell_quote_parts_origin_check" CHECK ("app"."bell_quote_parts"."origin" in ('calculated','legacy'))
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"previous_price" numeric(12, 2),
	"source" text DEFAULT 'snapshot' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bell_quote_prices_price_check" CHECK ("app"."bell_quote_prices"."price" >= 0),
	CONSTRAINT "bell_quote_prices_source_check" CHECK ("app"."bell_quote_prices"."source" in ('snapshot','override','imported'))
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_revisions" (
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
	CONSTRAINT "bell_quote_revisions_type_check" CHECK ("app"."bell_quote_revisions"."revision_type" in ('insert','update','submit','approve','cancel','refresh_prices','email','import'))
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"room_id" integer,
	"room_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_special_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_subtotal" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bell_quote_special_parts_qty_check" CHECK ("app"."bell_quote_special_parts"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quote_work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"work_order_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."bell_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"site_id" integer,
	"customer_id" integer,
	"status" smallint DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"quote_type" text DEFAULT 'LED' NOT NULL,
	"ceiling_grid_type" smallint,
	"is_type_maintenance" boolean DEFAULT false NOT NULL,
	"payment_terms_code" smallint,
	"due_date" date,
	"work_order_number" text,
	"attach_folder_path" text,
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
	CONSTRAINT "bell_quotes_status_check" CHECK ("app"."bell_quotes"."status" in (1,3,4,5)),
	CONSTRAINT "bell_quotes_type_check" CHECK ("app"."bell_quotes"."quote_type" in ('LED','Legacy')),
	CONSTRAINT "bell_quotes_grid_check" CHECK ("app"."bell_quotes"."ceiling_grid_type" is null or "app"."bell_quotes"."ceiling_grid_type" in (1,2,3,4)),
	CONSTRAINT "bell_quotes_payterms_check" CHECK ("app"."bell_quotes"."payment_terms_code" is null or "app"."bell_quotes"."payment_terms_code" in (1,3,4,5)),
	CONSTRAINT "bell_quotes_tax_rate_check" CHECK ("app"."bell_quotes"."applied_tax_rate" is null or ("app"."bell_quotes"."applied_tax_rate" >= 0 and "app"."bell_quotes"."applied_tax_rate" <= 1)),
	CONSTRAINT "bell_quotes_totals_check" CHECK ("app"."bell_quotes"."subtotal_amount" >= 0 and "app"."bell_quotes"."tax_amount" >= 0 and "app"."bell_quotes"."total_amount" >= 0 and "app"."bell_quotes"."without_markup_subtotal_amount" >= 0 and "app"."bell_quotes"."without_markup_tax_amount" >= 0 and "app"."bell_quotes"."without_markup_total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bell_room_template_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."bell_room_templates" (
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
CREATE TABLE "app"."bell_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" integer,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."bell_fixture_parts" ADD CONSTRAINT "bell_fixture_parts_fixture_id_bell_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "app"."bell_fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_foot_candle_readings" ADD CONSTRAINT "bell_foot_candle_readings_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_downloads" ADD CONSTRAINT "bell_quote_downloads_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_fixture_parts" ADD CONSTRAINT "bell_quote_fixture_parts_quote_fixture_id_bell_quote_fixtures_id_fk" FOREIGN KEY ("quote_fixture_id") REFERENCES "app"."bell_quote_fixtures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_fixture_parts" ADD CONSTRAINT "bell_quote_fixture_parts_fixture_part_id_bell_fixture_parts_id_fk" FOREIGN KEY ("fixture_part_id") REFERENCES "app"."bell_fixture_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_fixtures" ADD CONSTRAINT "bell_quote_fixtures_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_fixtures" ADD CONSTRAINT "bell_quote_fixtures_quote_room_id_bell_quote_rooms_id_fk" FOREIGN KEY ("quote_room_id") REFERENCES "app"."bell_quote_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_fixtures" ADD CONSTRAINT "bell_quote_fixtures_fixture_id_bell_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "app"."bell_fixtures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_parts" ADD CONSTRAINT "bell_quote_parts_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_prices" ADD CONSTRAINT "bell_quote_prices_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_revisions" ADD CONSTRAINT "bell_quote_revisions_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_rooms" ADD CONSTRAINT "bell_quote_rooms_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_rooms" ADD CONSTRAINT "bell_quote_rooms_room_id_bell_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."bell_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_special_parts" ADD CONSTRAINT "bell_quote_special_parts_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_work_orders" ADD CONSTRAINT "bell_quote_work_orders_quote_id_bell_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."bell_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quote_work_orders" ADD CONSTRAINT "bell_quote_work_orders_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_quotes" ADD CONSTRAINT "bell_quotes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_room_template_rooms" ADD CONSTRAINT "bell_room_template_rooms_template_id_bell_room_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."bell_room_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bell_room_template_rooms" ADD CONSTRAINT "bell_room_template_rooms_room_id_bell_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."bell_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bell_fixture_parts_fixture_part_unique" ON "app"."bell_fixture_parts" USING btree ("fixture_id","part_no");--> statement-breakpoint
CREATE INDEX "bell_fixture_parts_fixture_idx" ON "app"."bell_fixture_parts" USING btree ("fixture_id","sort_order");--> statement-breakpoint
CREATE INDEX "bell_fixture_parts_part_idx" ON "app"."bell_fixture_parts" USING btree ("part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_fixtures_name_unique" ON "app"."bell_fixtures" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "bell_fixtures_legacy_unique" ON "app"."bell_fixtures" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "bell_fixtures_active_idx" ON "app"."bell_fixtures" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "bell_foot_candle_readings_quote_idx" ON "app"."bell_foot_candle_readings" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "bell_quote_downloads_quote_idx" ON "app"."bell_quote_downloads" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_fixture_parts_unique" ON "app"."bell_quote_fixture_parts" USING btree ("quote_fixture_id","part_no");--> statement-breakpoint
CREATE INDEX "bell_quote_fixture_parts_fixture_idx" ON "app"."bell_quote_fixture_parts" USING btree ("quote_fixture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_fixtures_order_unique" ON "app"."bell_quote_fixtures" USING btree ("quote_room_id","sort_order");--> statement-breakpoint
CREATE INDEX "bell_quote_fixtures_quote_idx" ON "app"."bell_quote_fixtures" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_parts_quote_part_unique" ON "app"."bell_quote_parts" USING btree ("quote_id","part_no");--> statement-breakpoint
CREATE INDEX "bell_quote_parts_quote_idx" ON "app"."bell_quote_parts" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "bell_quote_parts_part_idx" ON "app"."bell_quote_parts" USING btree ("part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_prices_quote_part_unique" ON "app"."bell_quote_prices" USING btree ("quote_id","part_no");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_revisions_quote_seq_unique" ON "app"."bell_quote_revisions" USING btree ("quote_id","save_seq");--> statement-breakpoint
CREATE INDEX "bell_quote_revisions_quote_idx" ON "app"."bell_quote_revisions" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_rooms_order_unique" ON "app"."bell_quote_rooms" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE INDEX "bell_quote_rooms_quote_idx" ON "app"."bell_quote_rooms" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "bell_quote_special_parts_quote_idx" ON "app"."bell_quote_special_parts" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_wos_quote_wo_unique" ON "app"."bell_quote_work_orders" USING btree ("quote_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quote_wos_primary_unique" ON "app"."bell_quote_work_orders" USING btree ("quote_id") WHERE "app"."bell_quote_work_orders"."is_primary";--> statement-breakpoint
CREATE INDEX "bell_quote_wos_wo_idx" ON "app"."bell_quote_work_orders" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_quotes_legacy_unique" ON "app"."bell_quotes" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "bell_quotes_status_updated_idx" ON "app"."bell_quotes" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "bell_quotes_site_idx" ON "app"."bell_quotes" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "bell_quotes_customer_idx" ON "app"."bell_quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_room_template_rooms_order_unique" ON "app"."bell_room_template_rooms" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "bell_room_template_rooms_room_idx" ON "app"."bell_room_template_rooms" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bell_room_templates_name_unique" ON "app"."bell_room_templates" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "bell_room_templates_default_unique" ON "app"."bell_room_templates" USING btree ("is_default") WHERE "app"."bell_room_templates"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "bell_rooms_name_unique" ON "app"."bell_rooms" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "bell_rooms_legacy_unique" ON "app"."bell_rooms" USING btree ("legacy_id");--> statement-breakpoint
CREATE INDEX "bell_rooms_active_idx" ON "app"."bell_rooms" USING btree ("is_active","sort_order");
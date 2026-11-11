CREATE TYPE "app"."quote_kind" AS ENUM('customer', 'standalone');--> statement-breakpoint
CREATE TABLE "app"."quote_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"line_date" date,
	"hours" numeric(7, 2) DEFAULT '0' NOT NULL,
	"num_techs" integer DEFAULT 1 NOT NULL,
	"rate_code" text,
	"rate" numeric(9, 2) DEFAULT '0' NOT NULL,
	"incurred_hours" numeric(7, 2),
	"incurred_rate" numeric(9, 2),
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quote_packing_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"packing_slip_id" integer NOT NULL,
	"quote_part_id" integer,
	"part_no" text NOT NULL,
	"actual_qty" integer,
	"backorder_qty" integer DEFAULT 0 NOT NULL,
	"shipped_qty" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quote_packing_slips" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"date_created" date DEFAULT now() NOT NULL,
	"ship_date" date,
	"packing_slip_level" smallint DEFAULT 1 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quote_packing_special_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"packing_slip_id" integer NOT NULL,
	"quote_special_part_id" integer,
	"name" text NOT NULL,
	"actual_qty" integer,
	"backorder_qty" integer DEFAULT 0 NOT NULL,
	"shipped_qty" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"description" text,
	"qty" integer DEFAULT 0 NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_price" numeric(12, 2),
	"is_under_warranty" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quote_rejections" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"reason" text,
	"quote_content" jsonb,
	"rejected_by_detail" text,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quote_special_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_price" numeric(12, 2),
	"is_emergency_lighting" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "app"."quote_kind" NOT NULL,
	"work_order_number" integer,
	"site_id" integer NOT NULL,
	"ship_contact" text,
	"ship_street_1" text,
	"ship_street_2" text,
	"ship_city" text,
	"ship_province" text,
	"ship_postal_code" text,
	"is_address_updated" boolean DEFAULT false NOT NULL,
	"report" text,
	"notes" text,
	"pdf_notes" text,
	"status" smallint DEFAULT 1 NOT NULL,
	"payment_terms_id" smallint,
	"tax_code" text,
	"applied_tax_rate" numeric(9, 5),
	"manual_tax_amount" numeric(12, 2),
	"due_date" date,
	"is_due_date_tbd" boolean DEFAULT false NOT NULL,
	"date_approved" date,
	"date_created" date DEFAULT now() NOT NULL,
	"is_revision" boolean DEFAULT false NOT NULL,
	"revision_quote_id" integer,
	"root_quote_id" integer,
	"revision_id" numeric(6, 1) DEFAULT '0' NOT NULL,
	"is_last_revision" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_from_local" boolean DEFAULT false NOT NULL,
	"reference_wo_number" text,
	"converted_work_order_id" integer,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_check" CHECK ("app"."quotes"."status" between 1 and 5),
	CONSTRAINT "quotes_saved_kind_check" CHECK ("app"."quotes"."status" <> 2 or "app"."quotes"."kind" = 'standalone')
);
--> statement-breakpoint
CREATE TABLE "app"."generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"renderer_version" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"page_count" integer,
	"data_snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "app"."quote_hours" ADD CONSTRAINT "quote_hours_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_packing_parts" ADD CONSTRAINT "quote_packing_parts_packing_slip_id_quote_packing_slips_id_fk" FOREIGN KEY ("packing_slip_id") REFERENCES "app"."quote_packing_slips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_packing_slips" ADD CONSTRAINT "quote_packing_slips_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_packing_special_parts" ADD CONSTRAINT "quote_packing_special_parts_packing_slip_id_quote_packing_slips_id_fk" FOREIGN KEY ("packing_slip_id") REFERENCES "app"."quote_packing_slips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_parts" ADD CONSTRAINT "quote_parts_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_rejections" ADD CONSTRAINT "quote_rejections_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_special_parts" ADD CONSTRAINT "quote_special_parts_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "app"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_hours_quote_idx" ON "app"."quote_hours" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_packing_parts_slip_idx" ON "app"."quote_packing_parts" USING btree ("packing_slip_id");--> statement-breakpoint
CREATE INDEX "quote_packing_slips_quote_idx" ON "app"."quote_packing_slips" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_packing_special_parts_slip_idx" ON "app"."quote_packing_special_parts" USING btree ("packing_slip_id");--> statement-breakpoint
CREATE INDEX "quote_parts_quote_idx" ON "app"."quote_parts" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_rejections_quote_idx" ON "app"."quote_rejections" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_special_parts_quote_idx" ON "app"."quote_special_parts" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "app"."quotes" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "quotes_site_idx" ON "app"."quotes" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "quotes_work_order_number_idx" ON "app"."quotes" USING btree ("work_order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_chain_end" ON "app"."quotes" USING btree (coalesce("root_quote_id", "id")) WHERE "app"."quotes"."is_last_revision";
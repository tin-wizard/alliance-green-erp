CREATE TYPE "app"."subcontractor_document_kind" AS ENUM('wsib', 'insurance', 'other');--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"contact_name" text,
	"contact_number" text,
	"contact_email" text,
	"salesperson" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."part_groups" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer,
	"is_winner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."part_price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"last_value" text,
	"new_value" text,
	"changed_by" uuid,
	"section_name" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."part_selling_rate_lists" (
	"id" integer PRIMARY KEY NOT NULL,
	"list_heading" text,
	"list_date" date,
	"is_winner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."part_selling_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" integer NOT NULL,
	"list_id" integer,
	"old_sell_price" numeric(12, 2),
	"increase_percentage" integer,
	"sell_price" numeric(12, 2),
	"install_price" numeric(12, 2),
	"recycle_price" numeric(12, 2),
	"date_inserted" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."part_sub_suppliers" (
	"id" integer PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"name" text,
	"location" text,
	"contact_number" text,
	"contact_emails" text
);
--> statement-breakpoint
CREATE TABLE "app"."part_supplier_model_rates" (
	"id" integer PRIMARY KEY NOT NULL,
	"part_code" text,
	"list_id" integer,
	"supplier_id" integer,
	"model_price" text,
	"default_model" boolean DEFAULT false NOT NULL,
	"model_number" text
);
--> statement-breakpoint
CREATE TABLE "app"."part_supplier_rate_lists" (
	"id" integer PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"list_heading" text,
	"list_date" date,
	"has_buy_rates" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."part_supplier_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" integer NOT NULL,
	"supplier_id" integer,
	"sub_supplier_id" integer,
	"cost_price" numeric(12, 2),
	"last_cost_price" numeric(12, 2),
	"sell_price" numeric(12, 2),
	"last_sell_price" numeric(12, 2),
	"install_price" numeric(12, 2),
	"recycle_price" numeric(12, 2),
	"markup" numeric(7, 2),
	"model_number_1" text,
	"model_number_2" text,
	"model_number_3" text,
	"supplier_warranty" text,
	"default_rate" boolean DEFAULT false NOT NULL,
	"date_inserted" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."parts" (
	"id" integer PRIMARY KEY NOT NULL,
	"part_number" text NOT NULL,
	"name" text,
	"part_group_id" integer,
	"cost" numeric(12, 2),
	"sell_price" numeric(12, 2),
	"sage_item_id" integer,
	"active_in_sage" boolean DEFAULT true NOT NULL,
	"subignore" boolean DEFAULT false NOT NULL,
	"parent_part_number" text,
	"cls_linked_part_code" text,
	"warranty" text,
	"labour_warranty" text,
	"install_cost_per_unit" numeric(12, 2),
	"install_profit_formula" text,
	"recycle_profit_formula" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."shared_parts" (
	"part_code" text PRIMARY KEY NOT NULL,
	"main_part_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."site_warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" integer NOT NULL,
	"description" text,
	"expires_on" date,
	"document_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sites" (
	"id" integer PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"name" text NOT NULL,
	"street" text,
	"street_2" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"contact_name" text,
	"contact_number" text,
	"warranty" boolean DEFAULT false NOT NULL,
	"warranty_expires_on" date,
	"warranty_notes" text,
	"notes" text,
	"dns" text,
	"lift" text,
	"mall" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractor_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontractor_id" integer NOT NULL,
	"contact_name" text,
	"phone" text,
	"phone_ext" text
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontractor_id" integer NOT NULL,
	"kind" "app"."subcontractor_document_kind" DEFAULT 'wsib' NOT NULL,
	"document_type" text,
	"document_name" text,
	"storage_key" text,
	"file_name" text,
	"expires_on" date,
	"is_expired" boolean DEFAULT false NOT NULL,
	"reminder_state" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractors" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"contact_name" text,
	"contact_number" text,
	"contact_email" text,
	"email_2" text,
	"email_3" text,
	"rate_interior" numeric(12, 2),
	"rate_exterior" numeric(12, 2),
	"rate_other" numeric(12, 2),
	"stock_notification_alert_type" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."suppliers" (
	"id" integer PRIMARY KEY NOT NULL,
	"sage_vendor_id" integer,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"contact_person" text,
	"contact_number" text,
	"additional_emails" text,
	"additional_emails_accounting" text,
	"user_id" uuid,
	"is_under_cls" boolean DEFAULT false NOT NULL,
	"is_online_vendor" boolean DEFAULT false NOT NULL,
	"bypass_po_approval" boolean DEFAULT false NOT NULL,
	"po_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."part_price_history" ADD CONSTRAINT "part_price_history_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."part_selling_rates" ADD CONSTRAINT "part_selling_rates_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."part_supplier_rates" ADD CONSTRAINT "part_supplier_rates_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "app"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."site_warranties" ADD CONSTRAINT "site_warranties_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_contacts" ADD CONSTRAINT "subcontractor_contacts_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_documents" ADD CONSTRAINT "subcontractor_documents_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "app"."customers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "customers_city_idx" ON "app"."customers" USING btree (lower("city"));--> statement-breakpoint
CREATE INDEX "part_price_history_part_idx" ON "app"."part_price_history" USING btree ("part_id","changed_at");--> statement-breakpoint
CREATE INDEX "part_selling_rates_part_idx" ON "app"."part_selling_rates" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_supplier_model_rates_part_idx" ON "app"."part_supplier_model_rates" USING btree ("part_code");--> statement-breakpoint
CREATE INDEX "part_supplier_model_rates_supplier_idx" ON "app"."part_supplier_model_rates" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "part_supplier_rates_part_idx" ON "app"."part_supplier_rates" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_supplier_rates_supplier_idx" ON "app"."part_supplier_rates" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_part_number_unique" ON "app"."parts" USING btree ("part_number");--> statement-breakpoint
CREATE INDEX "parts_name_idx" ON "app"."parts" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "parts_group_idx" ON "app"."parts" USING btree ("part_group_id");--> statement-breakpoint
CREATE INDEX "site_warranties_site_idx" ON "app"."site_warranties" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "sites_customer_idx" ON "app"."sites" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sites_name_idx" ON "app"."sites" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "sites_city_idx" ON "app"."sites" USING btree (lower("city"));--> statement-breakpoint
CREATE INDEX "sites_street_idx" ON "app"."sites" USING btree (lower("street"));--> statement-breakpoint
CREATE INDEX "subcontractor_contacts_sub_idx" ON "app"."subcontractor_contacts" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "subcontractor_documents_sub_idx" ON "app"."subcontractor_documents" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "subcontractor_documents_expiry_idx" ON "app"."subcontractor_documents" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "subcontractors_name_idx" ON "app"."subcontractors" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "subcontractors_city_idx" ON "app"."subcontractors" USING btree (lower("city"));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_sage_vendor_unique" ON "app"."suppliers" USING btree ("sage_vendor_id");--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "app"."suppliers" USING btree (lower("name"));
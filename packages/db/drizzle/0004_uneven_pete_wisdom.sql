CREATE TABLE "app"."compliance_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subcontractor_id" integer NOT NULL,
	"document_id" uuid NOT NULL,
	"window_days" integer NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."import_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"local_id" integer NOT NULL,
	"sage_id" integer NOT NULL,
	"field" text NOT NULL,
	"sage_value" text,
	"local_value" text,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."import_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"local_id" integer NOT NULL,
	"sage_id" integer NOT NULL,
	"last_snapshot" jsonb,
	"last_import_hash" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sage_missing_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."local_id_allocations" (
	"entity" text PRIMARY KEY NOT NULL,
	"next_id" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."master_data_requests" (
	"key" uuid PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."supplier_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" integer NOT NULL,
	"contact_name" text,
	"phone" text,
	"phone_ext" text,
	"email" text
);
--> statement-breakpoint
ALTER TABLE "app"."customers" ADD COLUMN "sage_customer_id" integer;--> statement-breakpoint
ALTER TABLE "app"."sites" ADD COLUMN "sage_site_id" integer;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_documents" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_documents" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_documents" ADD COLUMN "checksum_sha256" text;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_documents" ADD COLUMN "uploaded_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_documents" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."subcontractors" ADD COLUMN "sage_subcontractor_id" integer;--> statement-breakpoint
ALTER TABLE "app"."compliance_reminders" ADD CONSTRAINT "compliance_reminders_document_id_subcontractor_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."subcontractor_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_reminders_document_window_unique" ON "app"."compliance_reminders" USING btree ("document_id","window_days");--> statement-breakpoint
CREATE INDEX "compliance_reminders_status_idx" ON "app"."compliance_reminders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "import_conflicts_status_idx" ON "app"."import_conflicts" USING btree ("status","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_conflicts_open_unique" ON "app"."import_conflicts" USING btree ("entity","local_id","field","status");--> statement-breakpoint
CREATE UNIQUE INDEX "import_state_entity_local_unique" ON "app"."import_state" USING btree ("entity","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_state_entity_sage_unique" ON "app"."import_state" USING btree ("entity","sage_id");--> statement-breakpoint
CREATE INDEX "master_data_requests_entity_idx" ON "app"."master_data_requests" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "supplier_contacts_supplier_idx" ON "app"."supplier_contacts" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_sage_customer_unique" ON "app"."customers" USING btree ("sage_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parts_sage_item_unique" ON "app"."parts" USING btree ("sage_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_sage_site_unique" ON "app"."sites" USING btree ("sage_site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontractors_sage_subcontractor_unique" ON "app"."subcontractors" USING btree ("sage_subcontractor_id");--> statement-breakpoint
-- Imported rows keep their id and gain an explicit Sage link. Local rows stay
-- negative and unlinked until the Sage import links them, so ids are never
-- renumbered.
UPDATE "app"."customers" SET "sage_customer_id" = "id" WHERE "id" > 0;--> statement-breakpoint
UPDATE "app"."sites" SET "sage_site_id" = "id" WHERE "id" > 0;--> statement-breakpoint
UPDATE "app"."subcontractors" SET "sage_subcontractor_id" = "id" WHERE "id" > 0;--> statement-breakpoint
INSERT INTO "app"."local_id_allocations" ("entity", "next_id") VALUES
  ('customer', 0), ('site', 0), ('subcontractor', 0), ('supplier', 0), ('part', 0)
ON CONFLICT ("entity") DO NOTHING;

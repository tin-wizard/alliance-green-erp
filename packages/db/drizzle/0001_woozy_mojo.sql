CREATE TYPE "app"."work_order_assignment_role" AS ENUM('lead', 'assist', 'subcontractor');--> statement-breakpoint
CREATE TYPE "app"."work_order_document_kind" AS ENUM('photo', 'document', 'signature', 'service_report', 'other');--> statement-breakpoint
CREATE TYPE "app"."work_order_notification_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "app"."work_order_revision_type" AS ENUM('create', 'update', 'dispatch', 'capture', 'complete', 'cancel', 'manual');--> statement-breakpoint
CREATE TABLE "app"."local_work_order_hours" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"line_date" date NOT NULL,
	"time_in" time,
	"time_out" time,
	"hours" numeric(7, 2) NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"tech_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."local_work_order_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" integer NOT NULL,
	"signer_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"note" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."local_work_order_techs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"tech_user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_assignments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"tech_user_id" uuid,
	"subcontractor_id" integer,
	"role" "app"."work_order_assignment_role" DEFAULT 'assist' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" integer NOT NULL,
	"kind" "app"."work_order_document_kind" DEFAULT 'document' NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"caption" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"retention_until" date,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_hours" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"line_date" date NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"rate_code" smallint DEFAULT 1 NOT NULL,
	"hourly_rate" numeric(9, 2) NOT NULL,
	"tech_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"user_id" uuid,
	"title" text,
	"notes" text,
	"notes_type" text DEFAULT 'note' NOT NULL,
	"previous_status" smallint,
	"status_id" smallint,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"event" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"recipient" text,
	"subject" text,
	"body" text,
	"status" "app"."work_order_notification_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_number_series" (
	"id" smallint PRIMARY KEY NOT NULL,
	"next_id" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_number_series_id_check" CHECK ("app"."work_order_number_series"."id" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"part_no" text NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_reports" (
	"work_order_id" integer PRIMARY KEY NOT NULL,
	"report" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_revisions" (
	"revision_id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_by_user_id" uuid,
	"revision_type" "app"."work_order_revision_type" DEFAULT 'manual' NOT NULL,
	"data_workorder" jsonb,
	"data_wo_hours" jsonb,
	"data_wo_local_hours" jsonb,
	"data_wo_parts" jsonb,
	"data_wo_soparts" jsonb,
	"data_wo_report" jsonb,
	"data_wo_tax" jsonb,
	"data_wo_notes" jsonb,
	"is_last_revision" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_special_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"is_emergency_lighting" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."work_order_tax" (
	"work_order_id" integer PRIMARY KEY NOT NULL,
	"tax_province" text DEFAULT 'ON' NOT NULL,
	"applied_tax_rate" numeric(9, 5),
	"applied_tax_rate_pst" numeric(9, 5),
	"manual_tax_amount" numeric(12, 2),
	"manual_subtotal_amount" numeric(12, 2),
	"subtotal_amount" numeric(12, 2),
	"tax_total" numeric(12, 2),
	"total_amount" numeric(12, 2),
	"computed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."work_orders" (
	"id" integer PRIMARY KEY NOT NULL,
	"series" smallint DEFAULT 1 NOT NULL,
	"site_id" integer NOT NULL,
	"service_type_id" smallint DEFAULT 1 NOT NULL,
	"priority_id" smallint DEFAULT 3 NOT NULL,
	"category_id" smallint,
	"status" smallint DEFAULT 1 NOT NULL,
	"date_taken" date DEFAULT current_date NOT NULL,
	"expected_completion" date,
	"service_required" text DEFAULT '' NOT NULL,
	"notes" text,
	"subcontractor_id" integer,
	"security_code" text,
	"customer_po" text,
	"is_local" boolean DEFAULT false NOT NULL,
	"is_project" boolean DEFAULT false NOT NULL,
	"is_tjx_quote" boolean DEFAULT false NOT NULL,
	"is_pma_order" boolean DEFAULT false NOT NULL,
	"is_marked_red" boolean DEFAULT false NOT NULL,
	"is_marked_green" boolean DEFAULT false NOT NULL,
	"is_marked_critical" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_note" text,
	"invoiced_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"sage_sales_done" boolean DEFAULT false NOT NULL,
	"stock_updated" boolean DEFAULT false NOT NULL,
	"only_portal_stock_updated" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_status_check" CHECK ("app"."work_orders"."status" between 1 and 12),
	CONSTRAINT "work_orders_series_check" CHECK ("app"."work_orders"."series" in (1, 2))
);
--> statement-breakpoint
ALTER TABLE "app"."local_work_order_hours" ADD CONSTRAINT "local_work_order_hours_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_work_order_signatures" ADD CONSTRAINT "local_work_order_signatures_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."local_work_order_techs" ADD CONSTRAINT "local_work_order_techs_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_documents" ADD CONSTRAINT "work_order_documents_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_hours" ADD CONSTRAINT "work_order_hours_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_notes" ADD CONSTRAINT "work_order_notes_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_notifications" ADD CONSTRAINT "work_order_notifications_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_parts" ADD CONSTRAINT "work_order_parts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_reports" ADD CONSTRAINT "work_order_reports_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_revisions" ADD CONSTRAINT "work_order_revisions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_special_parts" ADD CONSTRAINT "work_order_special_parts_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_order_tax" ADD CONSTRAINT "work_order_tax_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_work_order_hours_wo_idx" ON "app"."local_work_order_hours" USING btree ("work_order_id","line_date");--> statement-breakpoint
CREATE INDEX "local_work_order_signatures_wo_idx" ON "app"."local_work_order_signatures" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_work_order_techs_unique" ON "app"."local_work_order_techs" USING btree ("work_order_id","tech_user_id");--> statement-breakpoint
CREATE INDEX "local_work_order_techs_tech_idx" ON "app"."local_work_order_techs" USING btree ("tech_user_id");--> statement-breakpoint
CREATE INDEX "work_order_assignments_wo_idx" ON "app"."work_order_assignments" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_order_assignments_tech_idx" ON "app"."work_order_assignments" USING btree ("tech_user_id");--> statement-breakpoint
CREATE INDEX "work_order_assignments_sub_idx" ON "app"."work_order_assignments" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "work_order_documents_wo_idx" ON "app"."work_order_documents" USING btree ("work_order_id","kind");--> statement-breakpoint
CREATE INDEX "work_order_hours_wo_idx" ON "app"."work_order_hours" USING btree ("work_order_id","line_date");--> statement-breakpoint
CREATE INDEX "work_order_notes_wo_idx" ON "app"."work_order_notes" USING btree ("work_order_id","created_at");--> statement-breakpoint
CREATE INDEX "work_order_notifications_status_idx" ON "app"."work_order_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "work_order_parts_wo_idx" ON "app"."work_order_parts" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_order_revisions_wo_idx" ON "app"."work_order_revisions" USING btree ("work_order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_revisions_chain_end" ON "app"."work_order_revisions" USING btree ("work_order_id") WHERE "app"."work_order_revisions"."is_last_revision";--> statement-breakpoint
CREATE INDEX "work_order_special_parts_wo_idx" ON "app"."work_order_special_parts" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "app"."work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_orders_series_status_idx" ON "app"."work_orders" USING btree ("series","status");--> statement-breakpoint
CREATE INDEX "work_orders_site_idx" ON "app"."work_orders" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "work_orders_subcontractor_idx" ON "app"."work_orders" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "work_orders_expected_completion_idx" ON "app"."work_orders" USING btree ("expected_completion");--> statement-breakpoint
CREATE INDEX "work_orders_cursor_idx" ON "app"."work_orders" USING btree ("date_taken","id");--> statement-breakpoint
CREATE INDEX "work_orders_customer_po_idx" ON "app"."work_orders" USING btree ("customer_po");--> statement-breakpoint
-- Numbering counters, not business data. Both series start at 1 on a fresh
-- install; the migration that imports the legacy `wo_next_pid` rows raises them.
INSERT INTO "app"."work_order_number_series" ("id", "next_id", "description")
VALUES (1, 1, 'Main work-order series'), (2, 1, 'Maintenance work-order series')
ON CONFLICT ("id") DO NOTHING;
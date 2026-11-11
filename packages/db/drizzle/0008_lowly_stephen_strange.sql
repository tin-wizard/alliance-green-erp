CREATE TABLE "app"."sage_connections" (
	"environment" text PRIMARY KEY NOT NULL,
	"business_id" text,
	"access_token_sealed" text NOT NULL,
	"refresh_token_sealed" text NOT NULL,
	"access_token_fingerprint" text,
	"refresh_token_fingerprint" text,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"last_refresh_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'disconnected' NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sage_health_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"days_since_refresh" integer NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "app"."sage_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"requested_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sage_pause_state" (
	"environment" text PRIMARY KEY NOT NULL,
	"reason" text,
	"message" text,
	"since" timestamp with time zone,
	"until" timestamp with time zone,
	"consecutive_server_errors" smallint DEFAULT 0 NOT NULL,
	"window_attempts" integer DEFAULT 0 NOT NULL,
	"window_rejections" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sage_quota_usage" (
	"usage_day" date NOT NULL,
	"class" text NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rga_credit_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"credit_id" integer NOT NULL,
	"kind" text NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"part_no" text,
	"description" text NOT NULL,
	"qty" numeric(9, 2) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "rga_credit_lines_kind_check" CHECK ("app"."rga_credit_lines"."kind" in ('part','special'))
);
--> statement-breakpoint
CREATE TABLE "app"."rga_credits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rga_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"source_type" text DEFAULT 'rga' NOT NULL,
	"source_id" text,
	"credit_number" text NOT NULL,
	"credit_date" date DEFAULT current_date NOT NULL,
	"tax_province" text DEFAULT 'ON' NOT NULL,
	"applied_tax_rate" numeric(9, 5),
	"subtotal_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"posted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rga_credits_status_check" CHECK ("app"."rga_credits"."status" in ('draft','posted','void'))
);
--> statement-breakpoint
CREATE TABLE "app"."rga_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rga_id" integer NOT NULL,
	"notify_type" text NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_user_id" uuid,
	"recipient_email" text,
	"subject" text,
	"body" text,
	"idempotency_key" text NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rga_notifications_status_check" CHECK ("app"."rga_notifications"."status" in ('pending','sent','skipped','failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."rga_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rga_id" integer NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"part_no" text NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"return_qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reason_for_return" text,
	"under_warranty" boolean DEFAULT false NOT NULL,
	"purchase_type" text,
	"purchase_type_number" text,
	"po_number" text,
	"po_part_id" integer,
	"model_number" text,
	"original_invoice_number" text,
	"original_invoice_date" date
);
--> statement-breakpoint
CREATE TABLE "app"."rga_special_parts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rga_id" integer NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"qty" numeric(9, 2) NOT NULL,
	"return_qty" numeric(9, 2) NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reason_for_return" text,
	"purchase_type" text,
	"purchase_type_number" text,
	"po_number" text,
	"po_special_part_id" integer,
	"model_number" text,
	"original_invoice_number" text,
	"original_invoice_date" date
);
--> statement-breakpoint
CREATE TABLE "app"."rga_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rga_id" integer NOT NULL,
	"from_status" smallint,
	"to_status" smallint NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"note" text,
	"rga_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rgas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"po_id" integer,
	"work_order_id" integer,
	"site_id" integer,
	"subcontractor_id" integer,
	"rga_type" text DEFAULT 'rga' NOT NULL,
	"replacement_type" text,
	"status" smallint DEFAULT 2 NOT NULL,
	"legacy_status" smallint,
	"request_date" date DEFAULT current_date NOT NULL,
	"rga_notes" text,
	"internal_notes" text,
	"rga_invoice_number" text,
	"rga_invoice_date" date,
	"shipping_address" text,
	"is_critical" boolean DEFAULT false NOT NULL,
	"is_submitted" boolean DEFAULT false NOT NULL,
	"stock_updated" boolean DEFAULT false NOT NULL,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rgas_type_check" CHECK ("app"."rgas"."rga_type" in ('rga','credit','replacement')),
	CONSTRAINT "rgas_replacement_type_check" CHECK ("app"."rgas"."replacement_type" is null or "app"."rgas"."replacement_type" in ('supplier','subcontractor','customer','subcredit')),
	CONSTRAINT "rgas_status_check" CHECK ("app"."rgas"."status" in (2,3,4,6,7,10,11))
);
--> statement-breakpoint
CREATE TABLE "app"."job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"error" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_runs_status_check" CHECK ("app"."job_runs"."status" in ('running', 'succeeded', 'failed', 'skipped', 'missed'))
);
--> statement-breakpoint
ALTER TABLE "app"."site_warranties" ADD COLUMN "work_order_id" integer;--> statement-breakpoint
ALTER TABLE "app"."site_warranties" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."rga_credit_lines" ADD CONSTRAINT "rga_credit_lines_credit_id_rga_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "app"."rga_credits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_credits" ADD CONSTRAINT "rga_credits_rga_id_rgas_id_fk" FOREIGN KEY ("rga_id") REFERENCES "app"."rgas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_credits" ADD CONSTRAINT "rga_credits_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_notifications" ADD CONSTRAINT "rga_notifications_rga_id_rgas_id_fk" FOREIGN KEY ("rga_id") REFERENCES "app"."rgas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_parts" ADD CONSTRAINT "rga_parts_rga_id_rgas_id_fk" FOREIGN KEY ("rga_id") REFERENCES "app"."rgas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_parts" ADD CONSTRAINT "rga_parts_po_part_id_purchase_order_parts_id_fk" FOREIGN KEY ("po_part_id") REFERENCES "app"."purchase_order_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_special_parts" ADD CONSTRAINT "rga_special_parts_rga_id_rgas_id_fk" FOREIGN KEY ("rga_id") REFERENCES "app"."rgas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_special_parts" ADD CONSTRAINT "rga_special_parts_po_special_part_id_purchase_order_special_parts_id_fk" FOREIGN KEY ("po_special_part_id") REFERENCES "app"."purchase_order_special_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rga_status_history" ADD CONSTRAINT "rga_status_history_rga_id_rgas_id_fk" FOREIGN KEY ("rga_id") REFERENCES "app"."rgas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rgas" ADD CONSTRAINT "rgas_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rgas" ADD CONSTRAINT "rgas_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "app"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rgas" ADD CONSTRAINT "rgas_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rgas" ADD CONSTRAINT "rgas_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rgas" ADD CONSTRAINT "rgas_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sage_connections_state_idx" ON "app"."sage_connections" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sage_connections_refresh_expires_idx" ON "app"."sage_connections" USING btree ("refresh_expires_at");--> statement-breakpoint
CREATE INDEX "sage_health_samples_checked_idx" ON "app"."sage_health_samples" USING btree ("checked_at" desc);--> statement-breakpoint
CREATE INDEX "sage_oauth_states_expires_idx" ON "app"."sage_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sage_pause_state_reason_idx" ON "app"."sage_pause_state" USING btree ("reason");--> statement-breakpoint
CREATE UNIQUE INDEX "sage_quota_usage_day_class_unique" ON "app"."sage_quota_usage" USING btree ("usage_day","class");--> statement-breakpoint
CREATE INDEX "rga_credit_lines_credit_idx" ON "app"."rga_credit_lines" USING btree ("credit_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "rga_credits_rga_unique" ON "app"."rga_credits" USING btree ("rga_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rga_credits_number_unique" ON "app"."rga_credits" USING btree ("supplier_id","credit_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rga_notifications_idempotency_unique" ON "app"."rga_notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "rga_notifications_due_idx" ON "app"."rga_notifications" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "rga_notifications_rga_idx" ON "app"."rga_notifications" USING btree ("rga_id","created_at");--> statement-breakpoint
CREATE INDEX "rga_parts_rga_idx" ON "app"."rga_parts" USING btree ("rga_id","position");--> statement-breakpoint
CREATE INDEX "rga_special_parts_rga_idx" ON "app"."rga_special_parts" USING btree ("rga_id","position");--> statement-breakpoint
CREATE INDEX "rga_status_history_rga_idx" ON "app"."rga_status_history" USING btree ("rga_id","created_at");--> statement-breakpoint
CREATE INDEX "rgas_status_idx" ON "app"."rgas" USING btree ("status","request_date");--> statement-breakpoint
CREATE INDEX "rgas_supplier_idx" ON "app"."rgas" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "rgas_po_idx" ON "app"."rgas" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "rgas_wo_idx" ON "app"."rgas" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "rgas_sub_idx" ON "app"."rgas" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_key_scheduled_unique" ON "app"."job_runs" USING btree ("job_key","scheduled_for");--> statement-breakpoint
CREATE INDEX "job_runs_key_started_idx" ON "app"."job_runs" USING btree ("job_key","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "job_runs_status_lease_idx" ON "app"."job_runs" USING btree ("status","lease_expires_at");--> statement-breakpoint
ALTER TABLE "app"."site_warranties" ADD CONSTRAINT "site_warranties_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "app"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_warranties_expiry_idx" ON "app"."site_warranties" USING btree ("expires_on");
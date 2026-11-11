CREATE TABLE "app"."sage_probe_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"business_id" text,
	"business_name" text,
	"status" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sage_reconciliation_findings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"doc_type" text,
	"doc_id" text,
	"external_ref" text,
	"contact_id" text,
	"expected" numeric(14, 2),
	"actual" numeric(14, 2),
	"detail" jsonb,
	"owner" text NOT NULL,
	"decision" text DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app"."sage_reconciliation_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"money_total" numeric(14, 2),
	"findings" integer DEFAULT 0 NOT NULL,
	"blockers" integer DEFAULT 0 NOT NULL,
	"warnings" integer DEFAULT 0 NOT NULL,
	"error" text,
	"report" jsonb
);
--> statement-breakpoint
CREATE TABLE "app"."sage_sync_state" (
	"resource" text PRIMARY KEY NOT NULL,
	"watermark" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "app"."sage_reconciliation_findings" ADD CONSTRAINT "sage_reconciliation_findings_run_id_sage_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."sage_reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sage_probe_reports_run_idx" ON "app"."sage_probe_reports" USING btree ("run_at" desc);--> statement-breakpoint
CREATE INDEX "sage_reconciliation_findings_run_idx" ON "app"."sage_reconciliation_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sage_reconciliation_findings_code_idx" ON "app"."sage_reconciliation_findings" USING btree ("code","decision");--> statement-breakpoint
CREATE INDEX "sage_reconciliation_runs_started_idx" ON "app"."sage_reconciliation_runs" USING btree ("started_at" desc);--> statement-breakpoint
CREATE INDEX "sage_reconciliation_runs_status_idx" ON "app"."sage_reconciliation_runs" USING btree ("status","started_at");
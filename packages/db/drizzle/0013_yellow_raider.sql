ALTER TABLE "app"."sage_reconciliation_runs" ADD COLUMN "baseline_id" text;--> statement-breakpoint
ALTER TABLE "app"."sage_reconciliation_runs" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "app"."sage_reconciliation_runs" ADD COLUMN "divergence_total" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "app"."sage_reconciliation_runs" ADD COLUMN "signed_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."sage_reconciliation_runs" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."sage_reconciliation_runs" ADD COLUMN "signed_note" text;
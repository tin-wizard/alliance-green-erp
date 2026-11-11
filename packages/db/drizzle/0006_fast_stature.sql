CREATE TABLE "app"."part_price_locks" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"locked_by" uuid,
	"locked_by_name" text,
	"lock_time" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_price_locks_single_row_check" CHECK ("app"."part_price_locks"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "app"."part_stock_adjustments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"part_no" text NOT NULL,
	"part_id" integer,
	"qty" numeric(12, 2) NOT NULL,
	"price" numeric(12, 2),
	"adjustment_type" text DEFAULT 'global' NOT NULL,
	"notes" text,
	"is_log_deleted" boolean DEFAULT false NOT NULL,
	"work_order_number" integer,
	"site_id" integer,
	"subcontractor_id" integer,
	"mass_adjustment_number" integer,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_stock_adjustments_type_check" CHECK ("app"."part_stock_adjustments"."adjustment_type" in ('global','alliance','subcontractor','customer','contractor'))
);
--> statement-breakpoint
CREATE TABLE "app"."sub_stock_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_id" integer,
	"subcontractor_id" integer NOT NULL,
	"user_id" uuid,
	"user_type" text DEFAULT 'sub' NOT NULL,
	"username" text,
	"subject" text,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_by" uuid,
	"confirmation_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sub_stock_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subcontractor_id" integer NOT NULL,
	"user_id" uuid,
	"contain_stock" boolean DEFAULT true NOT NULL,
	"notification_code" text NOT NULL,
	"is_responded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" DROP CONSTRAINT "inventory_movements_type_check";--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "install_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "recycle_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "purchased_quantity" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "current_quantity" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."parts" ADD COLUMN "sold_quantity" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "part_id" integer;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "transaction_type" text DEFAULT 'Purchase' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "document_type" text;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "woid_poid" integer;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "invoice_id" integer;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "adjustment_type" text;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "on_field_counted_qty" text;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "adj_subcontractor" integer;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "adj_site" integer;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "is_log_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD COLUMN "is_included_in_stock_management" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "part_stock_adjustments_idempotency_unique" ON "app"."part_stock_adjustments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "part_stock_adjustments_part_idx" ON "app"."part_stock_adjustments" USING btree ("part_no","created_at");--> statement-breakpoint
CREATE INDEX "sub_stock_messages_sub_idx" ON "app"."sub_stock_messages" USING btree ("subcontractor_id","created_at");--> statement-breakpoint
CREATE INDEX "sub_stock_messages_unread_idx" ON "app"."sub_stock_messages" USING btree ("subcontractor_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_stock_notifications_code_unique" ON "app"."sub_stock_notifications" USING btree ("notification_code");--> statement-breakpoint
CREATE INDEX "sub_stock_notifications_sub_idx" ON "app"."sub_stock_notifications" USING btree ("subcontractor_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_part_created_idx" ON "app"."inventory_movements" USING btree ("part_no","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_type_idx" ON "app"."inventory_movements" USING btree ("transaction_type","created_at");--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_transaction_check" CHECK ("app"."inventory_movements"."transaction_type" in ('Sale','Purchase','Adjustment'));--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_type_check" CHECK ("app"."inventory_movements"."movement_type" in ('purchase_receipt','sale','adjustment','transfer_out','transfer_in'));
-- The global price-editor lock is a single row. TTL and takeover are explicit;
-- there is no cron that silently clears an expired lock.
INSERT INTO "app"."part_price_locks" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

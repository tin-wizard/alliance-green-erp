CREATE TYPE "app"."notification_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'skipped', 'suppressed');--> statement-breakpoint
CREATE TABLE "app"."notification_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"recipient_user_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"recipient_user_id" uuid,
	"recipient_email" text,
	"recipient_name" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"payload" jsonb,
	"dedupe_key" text,
	"status" "app"."notification_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"legacy_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."message_thread_participants" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_thread_participants_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"created_by" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."message_thread_participants" ADD CONSTRAINT "message_thread_participants_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "app"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "app"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_links_token_unique" ON "app"."notification_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "notification_links_entity_idx" ON "app"."notification_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notification_links_expiry_idx" ON "app"."notification_links" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "app"."notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_status_due_idx" ON "app"."notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "app"."notifications" USING btree ("recipient_user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "app"."notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "app"."notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_kind_idx" ON "app"."notifications" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "message_thread_participants_user_idx" ON "app"."message_thread_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_threads_last_message_idx" ON "app"."message_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "app"."messages" USING btree ("thread_id","created_at");--> statement-breakpoint
INSERT INTO "app"."notifications"
  ("kind","template_key","entity_type","entity_id","recipient_email","subject","body_text",
   "status","last_error","provider_message_id" ,"sent_at","legacy_ref","created_at","updated_at","next_attempt_at")
SELECT 'dispatch', 'work-order-' || "event", 'work_order', "work_order_id"::text, "recipient",
       COALESCE("subject", ''), COALESCE("body", ''),
       CASE "status"
         WHEN 'sent' THEN 'sent'::"app"."notification_status"
         WHEN 'failed' THEN 'failed'::"app"."notification_status"
         WHEN 'skipped' THEN 'skipped'::"app"."notification_status"
         ELSE 'queued'::"app"."notification_status"
       END,
       "error", NULL, "sent_at", 'work_order_notifications:' || "id"::text,
       "created_at", "created_at", "created_at"
FROM "app"."work_order_notifications";--> statement-breakpoint
INSERT INTO "app"."notifications"
  ("kind","template_key","entity_type","entity_id","recipient_user_id","recipient_email",
   "subject","body_text","status","last_error","sent_at","legacy_ref","created_at","updated_at","next_attempt_at")
SELECT 'rga', 'rga-' || lower("notify_type"), 'rga', "rga_id"::text, "recipient_user_id",
       "recipient_email", COALESCE("subject", ''), COALESCE("body", ''),
       CASE "status"
         WHEN 'sent' THEN 'sent'::"app"."notification_status"
         WHEN 'failed' THEN 'failed'::"app"."notification_status"
         WHEN 'skipped' THEN 'skipped'::"app"."notification_status"
         ELSE 'queued'::"app"."notification_status"
       END,
       "last_error", "sent_at", 'rga_notifications:' || "id"::text,
       "created_at", "created_at", "due_at"
FROM "app"."rga_notifications";
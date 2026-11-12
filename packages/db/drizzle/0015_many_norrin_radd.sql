CREATE SCHEMA "migration";
--> statement-breakpoint
CREATE TABLE "migration"."checkpoints" (
	"run_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"last_source_key" text,
	"batch_no" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_run_id_entity_pk" PRIMARY KEY("run_id","entity")
);
--> statement-breakpoint
CREATE TABLE "migration"."dump_manifests" (
	"dump_id" text PRIMARY KEY NOT NULL,
	"manifest_version" text NOT NULL,
	"table_count" integer NOT NULL,
	"checksum" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "migration"."dump_objects" (
	"dump_id" text NOT NULL,
	"table_name" text NOT NULL,
	"engine" text NOT NULL,
	"source_rows" bigint,
	"staged_rows" bigint,
	"checksum" text,
	"loaded_at" timestamp with time zone,
	"status" text DEFAULT 'loaded' NOT NULL,
	"note" text,
	CONSTRAINT "dump_objects_dump_id_table_name_pk" PRIMARY KEY("dump_id","table_name")
);
--> statement-breakpoint
CREATE TABLE "migration"."errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_key" text,
	"error_code" text NOT NULL,
	"message" text NOT NULL,
	"payload_hash" text,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "migration"."exceptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exception_class" text NOT NULL,
	"entity" text NOT NULL,
	"source_key" text NOT NULL,
	"row_count" bigint DEFAULT 1 NOT NULL,
	"migration_action" text NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"owner" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "migration_exceptions_unique" UNIQUE("exception_class","entity","source_key")
);
--> statement-breakpoint
CREATE TABLE "migration"."modules" (
	"module" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"run_id" uuid,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration"."row_map" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"source_table" text NOT NULL,
	"source_key" text NOT NULL,
	"target_table" text NOT NULL,
	"target_key" text NOT NULL,
	"dump_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_row_map_unique" UNIQUE("entity","source_table","source_key")
);
--> statement-breakpoint
CREATE TABLE "migration"."runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dump_id" text NOT NULL,
	"module" text NOT NULL,
	"phase" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"source_rows" bigint DEFAULT 0 NOT NULL,
	"transformed_rows" bigint DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"manifest_version" text NOT NULL,
	"git_sha" text DEFAULT 'unknown' NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "migration"."user_invites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"legacy_id" integer NOT NULL,
	"cohort" text NOT NULL,
	"email_hash" text,
	"token_hash" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_user_invites_legacy_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
ALTER TABLE "migration"."checkpoints" ADD CONSTRAINT "checkpoints_run_id_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "migration"."runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."errors" ADD CONSTRAINT "errors_run_id_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "migration"."runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "migration_errors_run_idx" ON "migration"."errors" USING btree ("run_id","entity");--> statement-breakpoint
CREATE INDEX "migration_exceptions_open_idx" ON "migration"."exceptions" USING btree ("decision","exception_class");--> statement-breakpoint
CREATE INDEX "migration_row_map_target_idx" ON "migration"."row_map" USING btree ("target_table","target_key");--> statement-breakpoint
CREATE INDEX "migration_runs_dump_idx" ON "migration"."runs" USING btree ("dump_id","module");
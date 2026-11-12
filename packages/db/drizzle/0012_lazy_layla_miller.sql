CREATE TABLE "app"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_type" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

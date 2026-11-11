CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."user_role" AS ENUM('admin', 'technician', 'subcontractor', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."legacy_material_checklist_returning_custom_enteries_r_62090c" AS ENUM('alliance', 'contractor', 'customer site', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_material_checklist_returning_parts_returning_to" AS ENUM('alliance', 'contractor', 'customer site', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_material_warranty_warranty_type" AS ENUM('warranty', 'labor');--> statement-breakpoint
CREATE TYPE "public"."legacy_parts_inventory_adjustment_adjustment_type" AS ENUM('global', 'alliance', 'subcontractor', 'customer', 'contractor', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_parts_salepurchase_log_adjustment_type" AS ENUM('alliance', 'subcontractor', 'customer', 'contractor', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_inv_tax_calc_type" AS ENUM('sub', 'sub_project', 'local', 'local_project', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_sc_inv_tax_calc_type" AS ENUM('sub', 'sub_project', 'local', 'local_project', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_sub_stock_messages_usertype" AS ENUM('', 'sub', 'admin');--> statement-breakpoint
CREATE TYPE "public"."legacy_po_preorder_parts_item_purchase_type" AS ENUM('workorder', 'stock', 'cls', 'projectpo');--> statement-breakpoint
CREATE TYPE "public"."legacy_po_preorder_soparts_item_purchase_type" AS ENUM('workorder', 'stock', 'cls', 'projectpo');--> statement-breakpoint
CREATE TYPE "public"."legacy_po_preorder_suppliers_supplier_response_status" AS ENUM('waiting', 'accepted', 'decline');--> statement-breakpoint
CREATE TYPE "public"."legacy_po_quote_suppliers_supplier_response_status" AS ENUM('waiting', 'accepted', 'decline');--> statement-breakpoint
CREATE TYPE "public"."legacy_purchaseorder_override_supplier_is_under" AS ENUM('', 'alliance', 'cls', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."legacy_purchaseorder_shipment_type" AS ENUM('alliance', 'cls', 'alliancepickup', 'clspickup', 'contractor', 'customer', 'subcontractor', 'clscustomer', 'alliancemaintenance', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_purchaseorder_transferring_from_type" AS ENUM('alliance', 'cls', 'alliancepickup', 'clspickup', 'contractor', 'customer', 'subcontractor', 'clscustomer', 'alliancemaintenance', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_tjx_fixture_parts_parttype" AS ENUM('Ballast', 'Lamp', '');--> statement-breakpoint
CREATE TYPE "public"."legacy_tjx_fixture_parts_per_quote_parttype" AS ENUM('Ballast', 'Lamp', '');--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"summary" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."permission_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."role_permissions" (
	"role" "app"."user_role" NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_key_pk" PRIMARY KEY("role","permission_key")
);
--> statement-breakpoint
CREATE TABLE "app"."user_permissions" (
	"user_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"is_allowed" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"scope_subcontractor_id" integer,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "user_permissions_user_id_permission_key_pk" PRIMARY KEY("user_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"neon_user_id" text,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"phone" text,
	"secondary_email" text,
	"department_type" text,
	"role" "app"."user_role" DEFAULT 'technician' NOT NULL,
	"legacy_access" smallint,
	"subcontractor_id" integer,
	"legacy_id" integer,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_checklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"workordernumber" integer NOT NULL,
	"quoteid" varchar(25),
	"sub_notes" text,
	"notes" text,
	"chk_all_reviewed" integer NOT NULL,
	"chk_all_skids_attached" integer,
	"chk_breif_walk_conducted" integer,
	"is_submitted" integer,
	"date_created" timestamp
);
--> statement-breakpoint
CREATE TABLE "material_checklist_custom_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" text,
	"qty" varchar(20),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "material_checklist_defective_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(50) NOT NULL,
	"part_description" text,
	"qty" varchar(20),
	"defective_by_default" integer,
	"defect_reason" varchar(80),
	"is_special_part" integer
);
--> statement-breakpoint
CREATE TABLE "material_checklist_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(50) NOT NULL,
	"notes" text,
	"is_special_part" integer
);
--> statement-breakpoint
CREATE TABLE "material_checklist_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(50),
	"part_description" text,
	"qty" varchar(20),
	"col_number" integer,
	"is_special_part" integer
);
--> statement-breakpoint
CREATE TABLE "material_checklist_returning_custom_enteries" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"description" text,
	"qty" varchar(20),
	"returning_to" "legacy_material_checklist_returning_custom_enteries_r_62090c"
);
--> statement-breakpoint
CREATE TABLE "material_checklist_returning_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(150),
	"part_description" text,
	"supplied_qty" varchar(20),
	"qty" varchar(20),
	"returning_to" "legacy_material_checklist_returning_parts_returning_to",
	"is_special_part" integer,
	"is_default_stock" integer,
	"qty_to_alliance" varchar(20),
	"qty_to_customer" varchar(20),
	"qty_to_contractor" varchar(20),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "material_warranty" (
	"id" serial PRIMARY KEY NOT NULL,
	"partno" varchar(30),
	"partdesc" text,
	"woid" integer,
	"site_id" integer,
	"warranty_type" "legacy_material_warranty_warranty_type",
	"start_date" date,
	"expiration_date" date
);
--> statement-breakpoint
CREATE TABLE "site_activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"row_id" integer,
	"table_name" varchar(50),
	"log_type" varchar(80),
	"user_id" integer,
	"log_date" timestamp,
	"php_filename" varchar(100),
	"section" varchar(50),
	"notes_comments" text
);
--> statement-breakpoint
CREATE TABLE "site_address_change_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"sage_address" text,
	"portal_address" text,
	"keep_warranty" varchar(10),
	"log_date" date
);
--> statement-breakpoint
CREATE TABLE "site_warranty" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"warranty_notes" text,
	"expiration_timespan" integer,
	"expiration_date" date
);
--> statement-breakpoint
CREATE TABLE "subcontractor_additional_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subid" integer NOT NULL,
	"document_name" text,
	"file_name" varchar(200),
	"document_notes" text,
	"uploaded_timespan" integer
);
--> statement-breakpoint
CREATE TABLE "subcontractor_wsib_insurance_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subid" integer NOT NULL,
	"document_type" varchar(20),
	"document_name" text,
	"file_name" varchar(200),
	"is_expired" integer,
	"expiration_timespan" integer,
	"expiration_date" date,
	"uploaded_timespan" integer,
	"near_expire_reminder_done" integer,
	"send_email_to_sub" integer,
	"email_sent_success" integer,
	"last_reminder_date" date
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(1000),
	"street" varchar(200),
	"city" varchar(50),
	"province" varchar(25),
	"postalcode" varchar(20),
	"cname" varchar(250),
	"cnumber" varchar(25),
	"cemail1" varchar(50),
	"salesp" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"custid" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"street" varchar(200) NOT NULL,
	"street_2" text,
	"city" varchar(50) NOT NULL,
	"province" varchar(25) NOT NULL,
	"postalcode" varchar(25),
	"cname" varchar(200),
	"cnumber" varchar(25),
	"warranty" smallint,
	"warranty_exp" date,
	"warranty_notes" text,
	"notes" text,
	"dns" varchar(10),
	"lift" varchar(10),
	"mall" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "subcontractor" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(75) NOT NULL,
	"street" varchar(200) NOT NULL,
	"city" varchar(50) NOT NULL,
	"province" varchar(25) NOT NULL,
	"postalcode" varchar(25) NOT NULL,
	"cname" varchar(250) NOT NULL,
	"cnumber" varchar(50) NOT NULL,
	"cemail1" varchar(50) NOT NULL,
	"cemail2" varchar(50),
	"cemail3" varchar(50),
	"interior" numeric(7, 2),
	"exterior" numeric(7, 2),
	"other" numeric(7, 2),
	"stock_notification_alert_type" integer
);
--> statement-breakpoint
CREATE TABLE "subcontractor_contact_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"subid" integer,
	"contact_name" varchar(60),
	"phone" varchar(60),
	"phone_ext" varchar(10)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"sage_vendor_id" integer,
	"name" varchar(50),
	"address" varchar(100),
	"city" varchar(80),
	"province" varchar(80),
	"postalcode" varchar(80),
	"additional_emails" text,
	"additional_emails_accounting" text,
	"contact_number" varchar(50),
	"contact_person" varchar(50),
	"user_id" integer,
	"is_under_cls" integer,
	"is_online_vendor" integer,
	"popnotes" text,
	"bypass_po_approval" integer
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(32) NOT NULL,
	"password" varchar(32) NOT NULL,
	"email" varchar(50) NOT NULL,
	"access" smallint NOT NULL,
	"subid" integer,
	"phone" varchar(25),
	"phone2" varchar(50),
	"phone2_ext" varchar(10),
	"email2" varchar(100),
	"full_name" text,
	"mailing_user" varchar(100),
	"mailing_password" varchar(250),
	"cls_mailing_user" text,
	"cls_mailing_password" text,
	"user_addworkorder_without_wsib" integer,
	"is_enabled" integer,
	"department_type" varchar(15)
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"name" text,
	"number" varchar(50),
	"cost" numeric(7, 2),
	"id" serial PRIMARY KEY NOT NULL,
	"subignore" smallint,
	"sell_price" numeric(7, 2),
	"sage_id" integer,
	"part_group_id" integer,
	"warranty" varchar(75),
	"labor_warranty" varchar(75),
	"purchased_quantity" numeric(7, 2),
	"current_quantity" numeric(7, 2),
	"sold_quantity" numeric(7, 2),
	"installcostperunit" varchar(15),
	"install_profit_formula" varchar(50),
	"recycle_profit_formula" varchar(50),
	"saved_sage_price" varchar(50),
	"is_sage_saved" integer,
	"part_popup_notes" text,
	"parent_partnumber" varchar(50),
	"cls_linked_partcode" varchar(20),
	"active_in_sage" integer,
	"defaultsortorder" integer
);
--> statement-breakpoint
CREATE TABLE "parts_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"shipment_detail" text,
	"purchased_quantity" integer,
	"cost_price" numeric(7, 2),
	"sell_price" numeric(7, 2),
	"markup" numeric(7, 2),
	"sold_quantity" integer,
	"status" varchar(15),
	"date_purchased" timestamp
);
--> statement-breakpoint
CREATE TABLE "parts_inventory_adjustment" (
	"id" serial PRIMARY KEY NOT NULL,
	"partno" varchar(50),
	"qty" varchar(15),
	"price" varchar(30),
	"date_created" timestamp,
	"adjustment_type" "legacy_parts_inventory_adjustment_adjustment_type",
	"notes" text,
	"is_log_deleted" integer,
	"inserted_datetime" timestamp,
	"workordernumber" varchar(25),
	"site" integer,
	"subcontractor" integer,
	"mass_adjustment_number" integer
);
--> statement-breakpoint
CREATE TABLE "parts_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"price_id" integer NOT NULL,
	"field_name" varchar(30) NOT NULL,
	"last_value" varchar(30),
	"new_value" varchar(30),
	"user_name" varchar(50) NOT NULL,
	"section_name" text,
	"date_inserted" timestamp
);
--> statement-breakpoint
CREATE TABLE "parts_price_lock" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_locked" integer,
	"locked_by" varchar(50),
	"lock_time" integer
);
--> statement-breakpoint
CREATE TABLE "parts_purchased_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_no" varchar(50),
	"part_desc" varchar(200),
	"inventory_tracking_id" integer,
	"invoice_number" varchar(50),
	"invoice_line_no" integer,
	"unit_price" numeric(7, 2),
	"qty" integer,
	"sage_vendor_id" integer,
	"date_invoiced" timestamp,
	"date_created_time" bigint
);
--> statement-breakpoint
CREATE TABLE "parts_purchasing_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer,
	"partno" varchar(50),
	"qty" varchar(15),
	"price" varchar(15),
	"stock_identifier" varchar(50),
	"date_created" timestamp
);
--> statement-breakpoint
CREATE TABLE "parts_salepurchase_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid_poid" integer,
	"invoice_id" integer,
	"invoice_number" varchar(50),
	"partno" varchar(50),
	"qty" varchar(15),
	"price" varchar(15),
	"date_created" timestamp,
	"transaction_type" varchar(15),
	"notes" text,
	"is_log_deleted" integer,
	"inserted_datetime" timestamp,
	"is_includeed_in_stock_management" integer,
	"adjustment_type" "legacy_parts_salepurchase_log_adjustment_type",
	"on_field_counted_qty" varchar(20),
	"adj_subcontractor" integer,
	"adj_site" integer
);
--> statement-breakpoint
CREATE TABLE "parts_selling_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer,
	"partno" varchar(50),
	"qty" varchar(15),
	"price" varchar(15),
	"date_created" timestamp
);
--> statement-breakpoint
CREATE TABLE "parts_selling_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_code" varchar(50),
	"list_id" integer,
	"old_sell_price" numeric(7, 2),
	"increase_percentage" integer,
	"sell_price" numeric(7, 2),
	"install_price" numeric(7, 2),
	"recycle_price" numeric(7, 2),
	"date_inserted" timestamp
);
--> statement-breakpoint
CREATE TABLE "parts_selling_rates_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_heading" varchar(100),
	"list_date" date,
	"is_winner" integer
);
--> statement-breakpoint
CREATE TABLE "parts_sub_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"name" varchar(50),
	"location" text,
	"contact_number" varchar(50),
	"contact_emails" text
);
--> statement-breakpoint
CREATE TABLE "parts_supplier_model_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_code" varchar(50),
	"list_id" integer,
	"supplier_id" integer,
	"model_price" varchar(50),
	"default_model" integer,
	"model_number" text
);
--> statement-breakpoint
CREATE TABLE "parts_supplier_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_code" varchar(50),
	"list_id" integer,
	"supplier_id" integer,
	"sub_supplier_id" integer,
	"cost_price" varchar(50),
	"last_cost_price" varchar(30),
	"date_inserted" timestamp,
	"markup" numeric(7, 2),
	"sell_price" numeric(7, 2),
	"last_sell_price" numeric(7, 2),
	"install_price" numeric(7, 2),
	"recycle_price" numeric(7, 2),
	"default_rate" integer,
	"model_number_1" text,
	"model_number_2" text,
	"model_number_3" text,
	"supplier_warranty" varchar(10),
	"cost_price_decimal" numeric(7, 2)
);
--> statement-breakpoint
CREATE TABLE "parts_supplier_rates_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"list_heading" varchar(100),
	"list_date" date,
	"has_buy_rates" integer
);
--> statement-breakpoint
CREATE TABLE "prf" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"description" text,
	"tech" varchar(50) NOT NULL,
	"date" date NOT NULL,
	"notes" text,
	"eta" date,
	"status" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_parts_list" (
	"partcode" varchar(15) NOT NULL,
	"main_partcode" varchar(15) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"rate" numeric(7, 2),
	"entered_rate" varchar(12),
	"date" date NOT NULL,
	"hours" numeric(7, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(11, 2) NOT NULL,
	"entered_price" varchar(12),
	"linked_sopart_cost_price" varchar(30),
	"linked_part_sopart" varchar(20),
	"is_local_part" integer,
	"applied_woid" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "inv_project" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"sage_project_workorder" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "inv_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(11, 2) NOT NULL,
	"entered_price" varchar(12),
	"is_local_part" integer,
	"is_emergency_lighting" integer,
	"is_service_report" integer,
	"warranty_years" varchar(25),
	"labor_warranty_years" varchar(25),
	"applied_woid" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "inv_tax" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"appliedtaxrate" varchar(15),
	"calc_type" "legacy_inv_tax_calc_type",
	"tax_amount" varchar(30),
	"subtotal_amount" varchar(30),
	"total_amount" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "rejected_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"invoice_no" varchar(100) NOT NULL,
	"date_rejected" integer NOT NULL,
	"rejected_reason" text,
	"invoice_content" text,
	"rejected_by_detail" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "sc_inv_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"rate" numeric(7, 2),
	"entered_rate" varchar(12),
	"date" date NOT NULL,
	"hours" numeric(7, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sc_inv_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(7, 2) NOT NULL,
	"entered_price" varchar(12),
	"linked_sopart_cost_price" varchar(30),
	"linked_part_sopart" varchar(20),
	"is_local_part" integer,
	"applied_woid" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "sc_inv_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(7, 2) NOT NULL,
	"entered_price" varchar(12),
	"is_local_part" integer,
	"is_emergency_lighting" integer,
	"is_service_report" integer,
	"warranty_years" varchar(25),
	"labor_warranty_years" varchar(25),
	"applied_woid" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "sc_inv_tax" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"appliedtaxrate" varchar(15),
	"calc_type" "legacy_sc_inv_tax_calc_type",
	"tax_amount" varchar(30),
	"subtotal_amount" varchar(30),
	"total_amount" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "customer_quote_payterms" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_quote_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_setup" (
	"id" serial PRIMARY KEY NOT NULL,
	"userid" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parts_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"sort_id" integer,
	"is_winner" integer
);
--> statement-breakpoint
CREATE TABLE "permission_type" (
	"id" serial PRIMARY KEY NOT NULL,
	"permission_name" varchar(50),
	"permission_heading" varchar(50),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "po_preorder_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_priority" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_quote_request_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_quote_submitted_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL,
	"sorting_order" integer
);
--> statement-breakpoint
CREATE TABLE "rga_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL,
	"sorting_order" integer
);
--> statement-breakpoint
CREATE TABLE "standalone_quote_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_grid_types" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_payterms" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wo_categories" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"code" varchar(25),
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wo_priority" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wo_servtype" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wo_status" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(25) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(200),
	"name" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "email_messages_to_sub" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"sender" varchar(50),
	"subid" integer NOT NULL,
	"receiver_emails" varchar(200) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"datetime" integer NOT NULL,
	"message" text NOT NULL,
	"file_attachments" text,
	"parent_id" integer,
	"confirmation_key" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender" varchar(100) NOT NULL,
	"receiver" varchar(100) NOT NULL,
	"subject" varchar(100) NOT NULL,
	"datetime" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"read" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer,
	"confirmation_key" text,
	"message_text" text,
	"message_title" varchar(100),
	"date" timestamp,
	"is_responded" integer
);
--> statement-breakpoint
CREATE TABLE "messages_links_po" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer,
	"confirmation_key" text,
	"message_text" text,
	"message_title" varchar(100),
	"date" timestamp,
	"is_responded" integer
);
--> statement-breakpoint
CREATE TABLE "sub_stock_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" integer,
	"subid" integer,
	"userid" integer,
	"usertype" "legacy_sub_stock_messages_usertype",
	"username" varchar(30),
	"message_subject" text,
	"message_text" text NOT NULL,
	"is_read" smallint,
	"is_read_by" integer,
	"date_created" timestamp,
	"confirmation_key" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "sub_stock_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"userid" integer,
	"subid" integer,
	"contain_stock" integer,
	"notification_code" varchar(10) NOT NULL,
	"date_created" timestamp,
	"is_responded" integer,
	"stockfilename" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "po_invoice" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer NOT NULL,
	"invoicenumber" varchar(100),
	"invoice_supplier_id" integer,
	"tax_amount" numeric(7, 2) NOT NULL,
	"tax_code" varchar(25) NOT NULL,
	"workordernumber" varchar(100),
	"shipping_charges" varchar(50),
	"cls_invoicenumber" varchar(50),
	"invoice_report" text,
	"tax_hst" numeric(7, 2),
	"tax_gst" numeric(7, 2),
	"tax_pst" numeric(7, 2),
	"tax_tvp" numeric(7, 2),
	"sub_total" varchar(25),
	"total_amount" varchar(25),
	"createdby" integer,
	"date_created" date,
	"invoice_date" date,
	"invoice_level" integer,
	"sage_done" integer,
	"stock_updated_during_mark_invoice" integer,
	"is_invoiced" integer,
	"rgaid" integer,
	"forced_markinvoice_button" integer,
	"appliedtaxrate" varchar(15),
	"appliedtaxrate_pst" varchar(12)
);
--> statement-breakpoint
CREATE TABLE "po_invoice_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer,
	"invoice_id" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"model_number" varchar(200),
	"actual_qty" numeric(7, 2),
	"backorder_qty" numeric(7, 2),
	"qty" numeric(7, 2),
	"price" varchar(20),
	"linetotal" varchar(20),
	"sortorder" integer,
	"sageprojectno" varchar(50),
	"invoice_project" varchar(60),
	"update_stock_quantity" integer
);
--> statement-breakpoint
CREATE TABLE "po_invoice_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer,
	"invoice_id" integer NOT NULL,
	"name" text NOT NULL,
	"po_so_part_id" integer NOT NULL,
	"actual_qty" numeric(7, 2),
	"backorder_qty" numeric(7, 2),
	"qty" numeric(7, 2),
	"price" varchar(20),
	"linetotal" varchar(20),
	"sortorder" integer,
	"sageprojectno" varchar(50),
	"invoice_project" varchar(60)
);
--> statement-breakpoint
CREATE TABLE "po_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer NOT NULL,
	"notify_type" varchar(10),
	"user_id" integer NOT NULL,
	"is_notified" integer
);
--> statement-breakpoint
CREATE TABLE "po_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer NOT NULL,
	"partno" varchar(100) NOT NULL,
	"qty" numeric(7, 2),
	"qty_received" numeric(7, 2),
	"price" varchar(20),
	"model_number" varchar(150),
	"none_customer_invoice_item" integer,
	"item_transferfrom_type" varchar(50),
	"item_transferfrom_type_number" varchar(50),
	"item_purchase_type" varchar(50),
	"item_purchase_type_number" varchar(50),
	"under_warranty" integer,
	"do_not_deduct_from" integer
);
--> statement-breakpoint
CREATE TABLE "po_preorder" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer,
	"report" text,
	"status" integer,
	"priority" integer,
	"notes" text,
	"is_without_quote" integer,
	"workordernumber" varchar(50),
	"createdby" integer,
	"date_received" date,
	"date_created" date
);
--> statement-breakpoint
CREATE TABLE "po_preorder_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"pre_poid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2),
	"list_id" integer,
	"supplier_id" integer,
	"sub_supplier_id" integer,
	"cost_price" varchar(20),
	"none_customer_invoice_item" integer,
	"item_purchase_type" "legacy_po_preorder_parts_item_purchase_type",
	"item_purchase_type_number" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "po_preorder_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"pre_poid" integer NOT NULL,
	"name" text NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2),
	"list_id" integer,
	"supplier_id" integer,
	"sub_supplier_id" integer,
	"cost_price" varchar(20),
	"none_customer_invoice_item" integer,
	"item_purchase_type" "legacy_po_preorder_soparts_item_purchase_type",
	"item_purchase_type_number" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "po_preorder_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"pre_poid" integer,
	"supplier_id" integer,
	"sub_supplier_id" integer,
	"list_id" integer,
	"supplier_response_status" "legacy_po_preorder_suppliers_supplier_response_status",
	"quotes_counter" integer,
	"resubmission_request" integer,
	"dated" timestamp,
	"msg_notes" text,
	"processed_as_order" integer
);
--> statement-breakpoint
CREATE TABLE "po_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer,
	"report" text,
	"status" integer,
	"priority" integer,
	"notes" text,
	"date_received" date,
	"date_created" date
);
--> statement-breakpoint
CREATE TABLE "po_quote_requested_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"req_qoid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2),
	"supplier_lists" text
);
--> statement-breakpoint
CREATE TABLE "po_quote_requested_parts_detail" (
	"id" serial PRIMARY KEY NOT NULL,
	"req_qoid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2),
	"list_id" integer,
	"supplier_id" integer,
	"cost_price" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "po_quote_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"req_qoid" integer,
	"supplier_id" integer,
	"list_id" integer,
	"sage_id" integer,
	"supplier_user_id" integer,
	"supplier_response_status" "legacy_po_quote_suppliers_supplier_response_status",
	"quotes_counter" integer,
	"resubmission_request" integer,
	"dated" timestamp,
	"msg_notes" text
);
--> statement-breakpoint
CREATE TABLE "po_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"qty" numeric(7, 2),
	"qty_received" numeric(7, 2),
	"price" varchar(20),
	"model_number" varchar(150),
	"none_customer_invoice_item" integer,
	"item_transferfrom_type" varchar(50),
	"item_transferfrom_type_number" varchar(50),
	"item_purchase_type" varchar(50),
	"item_purchase_type_number" varchar(50),
	"do_not_deduct_from" integer
);
--> statement-breakpoint
CREATE TABLE "po_submission_after_approval" (
	"id" serial PRIMARY KEY NOT NULL,
	"poid" integer,
	"email_subject" text,
	"email_notes" text,
	"main_email" text,
	"allianceemails" text,
	"cc_emails" text,
	"attach_po_file" varchar(10),
	"attach_all_files" varchar(10),
	"attach_individual_files" text,
	"submit_by" integer,
	"is_pending" integer,
	"date_created" timestamp
);
--> statement-breakpoint
CREATE TABLE "po_supplier_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"req_qoid" integer,
	"poid" integer,
	"supplier_id" integer,
	"report" text,
	"status" integer,
	"priority" integer,
	"notes" text,
	"exp_delivery_date" date,
	"date_created" date,
	"resubmission_request" integer,
	"processed_as_order" integer
);
--> statement-breakpoint
CREATE TABLE "po_supplier_quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sup_qoid" integer,
	"req_qoid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2),
	"additional_note" text
);
--> statement-breakpoint
CREATE TABLE "purchaseorder" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_number" varchar(20),
	"invoice_number" varchar(50),
	"supplier_id" integer,
	"sub_supplier_id" integer,
	"cust_qoid" integer,
	"tjx_quoteid" integer,
	"pre_poid" integer,
	"sup_poid" integer,
	"req_qoid" integer,
	"sup_qoid" integer,
	"status" integer,
	"status_on_july_21_2025" integer,
	"priority" integer,
	"supplier_notes" text,
	"notes" text,
	"expdeliverydate" date,
	"tax_code" varchar(50),
	"appliedtaxrate" varchar(12),
	"fob" text,
	"pay_terms" text,
	"ship_address_contactname" text,
	"ship_address_company" text,
	"ship_address_street1" text,
	"ship_address_street2" text,
	"ship_address_city" text,
	"ship_address_province" text,
	"ship_address_postalcode" text,
	"ship_address_phone" text,
	"shipping_address" text,
	"securitycode" varchar(50),
	"shipping_code" varchar(50),
	"ship_via" varchar(50),
	"createdby" integer,
	"is_marked_critical" integer,
	"is_submitted" integer,
	"completiondate" integer,
	"date_created" timestamp,
	"date_completed" timestamp,
	"po_folder_attach_path" varchar(200),
	"is_online_vendor_order" integer,
	"stock_updated" integer,
	"revision_no" integer,
	"is_type_maintenance" integer,
	"shipment_type" "legacy_purchaseorder_shipment_type",
	"shipment_type_correction" varchar(30),
	"shipment_type_bkup_18july2025" varchar(30),
	"customerid" integer,
	"subcontractorid" integer,
	"is_alliance_stocktransfer_po" integer,
	"trackingid" varchar(50),
	"print_records_per_page" integer,
	"tjx_parts_qty_type" varchar(15),
	"is_approved" integer,
	"override_supplier_is_under" "legacy_purchaseorder_override_supplier_is_under",
	"transferring_from_type" "legacy_purchaseorder_transferring_from_type",
	"is_alliance_stocktransfer_po_old" integer,
	"from_subcontractorid" integer,
	"from_customerid" integer,
	"transfer_from_contactname" varchar(50),
	"transfer_from_company" varchar(50),
	"transfer_from_street1" varchar(100),
	"transfer_from_street2" varchar(100),
	"transfer_from_city" varchar(20),
	"transfer_from_province" varchar(15),
	"transfer_from_postalcode" varchar(15),
	"transfer_from_phone" varchar(30),
	"transfer_from_address" text,
	"transfer_came_from_poid" integer,
	"po_submitted_by" varchar(15),
	"approval_request_by" integer,
	"last_status" integer,
	"status_changed_date" timestamp,
	"last_followup_reminder_date" date
);
--> statement-breakpoint
CREATE TABLE "rga" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"poid" integer,
	"status" integer,
	"status_on_july_21_2025" integer,
	"rga_notes" text,
	"notes" text,
	"request_date" date,
	"rga_invoicedate" varchar(50),
	"rga_invoicenumber" varchar(50),
	"ship_address_contactname" text,
	"ship_address_company" text,
	"ship_address_street1" text,
	"ship_address_street2" text,
	"ship_address_city" text,
	"ship_address_province" text,
	"ship_address_postalcode" text,
	"ship_address_phone" text,
	"shipping_address" text,
	"createdby" integer,
	"is_marked_critical" integer,
	"completiondate" integer,
	"date_created" timestamp,
	"date_completed" timestamp,
	"rga_folder_attach_path" varchar(200),
	"is_online_vendor_order" integer,
	"stock_updated" integer,
	"revision_no" integer,
	"is_type_maintenance" integer,
	"is_submitted" integer,
	"rga_type" varchar(20),
	"replacement_type" varchar(25),
	"subcontractor" integer,
	"site" integer,
	"workordernumber" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "rga_invoice" (
	"id" serial PRIMARY KEY NOT NULL,
	"rgaid" integer NOT NULL,
	"invoicenumber" varchar(100),
	"invoice_supplier_id" integer,
	"tax_amount" numeric(7, 2) NOT NULL,
	"tax_code" varchar(25) NOT NULL,
	"workordernumber" varchar(100),
	"shipping_charges" varchar(50),
	"cls_invoicenumber" varchar(50),
	"invoice_report" text,
	"tax_hst" numeric(7, 2),
	"tax_gst" numeric(7, 2),
	"tax_pst" numeric(7, 2),
	"tax_tvp" numeric(7, 2),
	"sub_total" varchar(25),
	"total_amount" varchar(25),
	"createdby" integer,
	"date_created" date,
	"invoice_date" date,
	"invoice_level" integer,
	"sage_done" integer,
	"is_invoiced" integer
);
--> statement-breakpoint
CREATE TABLE "rga_invoice_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rgaid" integer,
	"invoice_id" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"actual_qty" integer,
	"backorder_qty" integer NOT NULL,
	"qty" integer,
	"price" varchar(20),
	"linetotal" varchar(20),
	"sortorder" integer,
	"sageprojectno" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "rga_invoice_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rgaid" integer,
	"invoice_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"rga_so_part_id" integer NOT NULL,
	"actual_qty" integer,
	"backorder_qty" integer NOT NULL,
	"qty" integer,
	"price" varchar(20),
	"linetotal" varchar(20),
	"sortorder" integer,
	"sageprojectno" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "rga_notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"rgaid" integer NOT NULL,
	"notify_type" varchar(30),
	"user_id" integer NOT NULL,
	"is_notified" integer,
	"notify_date" date
);
--> statement-breakpoint
CREATE TABLE "rga_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rgaid" integer NOT NULL,
	"partno" varchar(50) NOT NULL,
	"qty" numeric(7, 2),
	"price" varchar(20),
	"model_number" varchar(150),
	"reason_for_return" text,
	"item_purchase_type" varchar(50),
	"item_purchase_type_number" varchar(50),
	"po_number" varchar(50),
	"po_part_id" integer,
	"return_qty" varchar(15),
	"under_warranty" integer,
	"rp_invoicenumber" varchar(100),
	"rp_invoicedate" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "rga_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rgaid" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"qty" numeric(7, 2),
	"price" varchar(20),
	"model_number" varchar(150),
	"reason_for_return" text,
	"item_purchase_type" varchar(50),
	"item_purchase_type_number" varchar(50),
	"po_number" varchar(50),
	"po_sopart_id" integer,
	"return_qty" varchar(15),
	"rp_invoicenumber" varchar(25),
	"rp_invoicedate" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "calcquote_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"rate" numeric(7, 2) NOT NULL,
	"entered_rate" varchar(15),
	"numtechs" integer,
	"date" date
);
--> statement-breakpoint
CREATE TABLE "calcquote_hours_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"rate" numeric(7, 2) NOT NULL,
	"entered_rate" varchar(15),
	"date" date,
	"numtechs" integer
);
--> statement-breakpoint
CREATE TABLE "calcquote_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(100),
	"incurred_cost" numeric(7, 2)
);
--> statement-breakpoint
CREATE TABLE "calcquote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(11, 2) NOT NULL,
	"entered_price" varchar(15),
	"is_under_warranty" integer
);
--> statement-breakpoint
CREATE TABLE "calcquote_parts_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(11, 2) NOT NULL,
	"entered_price" varchar(15),
	"is_under_warranty" integer
);
--> statement-breakpoint
CREATE TABLE "calcquote_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"report" text NOT NULL,
	"incurred_report" text,
	"status" varchar(20) NOT NULL,
	"date" date NOT NULL,
	"tax" numeric(7, 2) NOT NULL,
	"incurred" numeric(7, 2),
	"is_sub_quote" smallint,
	"taxcode" varchar(15),
	"add_province_taxcode" varchar(30),
	"is_calculated" integer,
	"is_after_two_cent" integer
);
--> statement-breakpoint
CREATE TABLE "calcquote_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(250) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"entered_price" varchar(15),
	"is_emergency_lighting" integer
);
--> statement-breakpoint
CREATE TABLE "calcquote_soparts_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(250) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"entered_price" varchar(15),
	"is_emergency_lighting" integer
);
--> statement-breakpoint
CREATE TABLE "customer_qo_packing_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer,
	"packing_slip_id" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"actual_qty" integer,
	"backorder_qty" integer NOT NULL,
	"shipped_qty" integer,
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "customer_qo_packing_slip" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer NOT NULL,
	"date_created" date,
	"ship_date" date,
	"packing_slip_level" integer
);
--> statement-breakpoint
CREATE TABLE "customer_qo_packing_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer,
	"packing_slip_id" integer NOT NULL,
	"qo_sopart_id" integer,
	"name" varchar(150) NOT NULL,
	"actual_qty" integer,
	"backorder_qty" integer NOT NULL,
	"shipped_qty" integer,
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "customer_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"workordernumber" integer,
	"site" integer,
	"ShipCntc" text,
	"ShipStrt1" text,
	"ShipStrt2" text,
	"ShipCity" text,
	"ShipPrvSt" text,
	"ShipPstZp" text,
	"is_address_updated" integer,
	"report" text,
	"status" integer,
	"payment_terms" integer,
	"notes" text,
	"appliedtaxrate" varchar(12),
	"tax_code" varchar(50),
	"tax_amount" varchar(50),
	"createdby" integer,
	"due_date" date,
	"is_due_date_tbd" integer,
	"date_approved" date,
	"date_created" date,
	"is_revision" integer,
	"revision_quote_id" integer,
	"revision_id" double precision
);
--> statement-breakpoint
CREATE TABLE "customer_quote_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"rate" numeric(7, 2) NOT NULL,
	"date" date
);
--> statement-breakpoint
CREATE TABLE "customer_quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(11, 2)
);
--> statement-breakpoint
CREATE TABLE "customer_quote_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"cust_qoid" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(11, 2)
);
--> statement-breakpoint
CREATE TABLE "quote_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"rate" integer NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"hourly_rate" numeric(7, 2),
	"date" date
);
--> statement-breakpoint
CREATE TABLE "quote_hours_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"rate" integer NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"hourly_rate" numeric(7, 2),
	"date" date
);
--> statement-breakpoint
CREATE TABLE "quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(11, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_parts_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"report" text NOT NULL,
	"date" timestamp,
	"tax" numeric(7, 2),
	"tax_code" varchar(10)
);
--> statement-breakpoint
CREATE TABLE "quote_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(11, 2) NOT NULL,
	"is_emergency_lighting" integer
);
--> statement-breakpoint
CREATE TABLE "quote_soparts_incurred" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric(7, 2) NOT NULL,
	"is_emergency_lighting" integer
);
--> statement-breakpoint
CREATE TABLE "standalone_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"workordernumber" integer,
	"site" integer,
	"ShipCntc" text,
	"ShipStrt1" text,
	"ShipStrt2" text,
	"ShipCity" text,
	"ShipPrvSt" text,
	"ShipPstZp" text,
	"is_address_updated" integer,
	"pdf_notes" text,
	"status" integer,
	"reference_wo_number" varchar(25),
	"notes" text,
	"appliedtaxrate" varchar(12),
	"tax_code" varchar(50),
	"tax_amount" varchar(50),
	"createdby" integer,
	"date_approved" date,
	"date_created" date,
	"is_revision" integer,
	"revision_quote_id" integer,
	"revision_id" double precision,
	"created_from_local" integer,
	"is_deleted" integer
);
--> statement-breakpoint
CREATE TABLE "standalone_quote_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"sal_qoid" integer NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"numtechs" integer,
	"rate" numeric(7, 2) NOT NULL,
	"date" date
);
--> statement-breakpoint
CREATE TABLE "standalone_quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sal_qoid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"qty" integer NOT NULL,
	"entered_price" varchar(30),
	"price" numeric(10, 2),
	"is_under_warranty" integer
);
--> statement-breakpoint
CREATE TABLE "standalone_quote_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sal_qoid" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"qty" integer NOT NULL,
	"entered_price" varchar(30),
	"price" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "api_sc_callback_url_response" (
	"id" serial PRIMARY KEY NOT NULL,
	"notes" text,
	"execute_timeint" bigint,
	"runtime" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "api_sc_status_webhook" (
	"id" serial PRIMARY KEY NOT NULL,
	"notes" text,
	"json_response" text,
	"execute_timeint" bigint,
	"hookname" varchar(80),
	"event_type" varchar(50),
	"woid" integer,
	"customerpo" varchar(50),
	"status_primary" varchar(30),
	"status_extended" varchar(30),
	"is_read" integer,
	"created_time" timestamp
);
--> statement-breakpoint
CREATE TABLE "api_sc_webhook" (
	"id" serial PRIMARY KEY NOT NULL,
	"notes" text,
	"json_response" text,
	"execute_timeint" bigint,
	"hookname" varchar(80),
	"event_type" varchar(50),
	"woid" integer,
	"customerpo" varchar(50),
	"status_primary" varchar(30),
	"status_extended" varchar(30),
	"is_read" integer,
	"created_time" timestamp
);
--> statement-breakpoint
CREATE TABLE "cron_run_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"cronname" varchar(50),
	"execute_timeint" bigint,
	"runtime" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "errors_log_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" varchar(100),
	"created_time" varchar(100),
	"revision_type" varchar(100),
	"user_id" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "rejected_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"date_rejected" integer NOT NULL,
	"rejected_reason" text,
	"quote_content" text,
	"rejected_by_detail" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "servchannel_api_setting" (
	"id" serial PRIMARY KEY NOT NULL,
	"setting_name" varchar(30),
	"setting_value" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "signoff_cron" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"is_processed" integer,
	"timespan_uploaded" integer,
	"timespan_processed" integer,
	"signature_found" integer,
	"is_reviewed" integer
);
--> statement-breakpoint
CREATE TABLE "undispatched_batch_upload" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_timespan" bigint
);
--> statement-breakpoint
CREATE TABLE "undispatched_workorders" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" varchar(50),
	"location_name" varchar(100),
	"site_id" integer,
	"tracking_no" varchar(100),
	"nte" numeric(7, 2),
	"address" varchar(100),
	"province" varchar(8),
	"city" varchar(100),
	"category" text,
	"batch_id" integer,
	"batch_type" varchar(20),
	"created_timespan" bigint,
	"is_imported" integer,
	"re_updated" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_fixture" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixturename" varchar(80),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_fixture_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"partno" varchar(30),
	"fixtureid" integer,
	"markup" varchar(10),
	"parttype" "legacy_tjx_fixture_parts_parttype",
	"part_ratio_perfixture" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "tjx_fixture_parts_per_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"partno" varchar(30),
	"quoteid" integer NOT NULL,
	"fixtureid" integer,
	"markup" varchar(10),
	"parttype" "legacy_tjx_fixture_parts_per_quote_parttype",
	"part_ratio_perfixture" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "tjx_fixture_per_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixtureid" integer,
	"quoteid" integer,
	"fixturename" varchar(80),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_prices_per_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer NOT NULL,
	"partno" varchar(20) NOT NULL,
	"price" varchar(25),
	"last_price" varchar(25)
);
--> statement-breakpoint
CREATE TABLE "tjx_quote" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" integer,
	"pdf_notes" text,
	"notes" text,
	"due_date" varchar(15),
	"payment_terms" integer,
	"ceiling_grid_type" integer,
	"ship_address_contactname" text,
	"ship_address_company" text,
	"ship_address_street1" text,
	"ship_address_street2" text,
	"ship_address_city" text,
	"ship_address_province" text,
	"ship_address_postalcode" text,
	"ship_address_phone" text,
	"shipping_address" text,
	"createdby" integer,
	"date_created" timestamp,
	"tjxquote_folder_attach_path" varchar(200),
	"revision_no" integer,
	"is_submitted" integer,
	"ship_to_type" varchar(15),
	"site" integer,
	"workordernumber" varchar(20),
	"tax_code" varchar(12),
	"tax_amount" varchar(15),
	"subtotal_amount" varchar(15),
	"total_amount" varchar(15),
	"withoutmarkup_tax_amount" varchar(15),
	"withoutmarkup_subtotal_amount" varchar(15),
	"withoutmarkup_total_amount" varchar(15),
	"revision_notes" text,
	"quote_type" varchar(15),
	"appliedtaxrate" varchar(12),
	"is_type_maintenance" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer,
	"filename" varchar(50),
	"downloadbyname" varchar(30),
	"foldername" varchar(20),
	"datecreated" timestamp,
	"download_revision_notes" text
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_extra_workorders" (
	"id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer,
	"woid" integer,
	"is_project_workorder" integer,
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomid" integer,
	"fixtureid" integer,
	"totalfixtures" varchar(12),
	"quoteid" integer,
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_lastused_sharedpart" (
	"quoteid" integer NOT NULL,
	"used_partcode" varchar(15) NOT NULL,
	"main_partcode" varchar(15) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer NOT NULL,
	"partno" varchar(30) NOT NULL,
	"fixtured_partno" varchar(30),
	"qty" integer NOT NULL,
	"without_markup_qty" integer,
	"price" numeric(7, 2),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_revisions" (
	"revision_id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer,
	"created_time" timestamp,
	"revised_by_user" integer,
	"revision_type" varchar(45),
	"data_quote" text,
	"data_fixtures" text,
	"data_parts" text,
	"data_soparts" text
);
--> statement-breakpoint
CREATE TABLE "tjx_quote_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer NOT NULL,
	"name" varchar(150),
	"qty" integer,
	"price" numeric(7, 2),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_room" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomname" varchar(80),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_rooms_template" (
	"roomid" integer,
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_sub_invoice" (
	"id" serial PRIMARY KEY NOT NULL,
	"quoteid" integer,
	"notes" text,
	"sub_notes" text,
	"invoice_date" varchar(15),
	"createdby" integer,
	"date_created" timestamp,
	"is_submitted" integer,
	"invoice_number" varchar(30),
	"workordernumber" varchar(20),
	"tax_code" varchar(12),
	"tax_total" varchar(15),
	"tax_gst" varchar(15),
	"tax_pst" varchar(15),
	"tax_amount" varchar(15),
	"subtotal_amount" varchar(15),
	"total_amount" varchar(15),
	"chk_project_reading" integer,
	"chk_project_photos" integer,
	"chk_project_signoff" integer,
	"rejected_count" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_sub_invoice_fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoiceid" integer,
	"roomid" integer,
	"otherroom" varchar(100),
	"fixtureid" integer,
	"totalfixtures" varchar(30),
	"installedqty_totalfixtures" varchar(30),
	"quoted_roomid" integer,
	"quoted_fixtureid" integer,
	"discrepancy_notes" text,
	"tjx_quote_fixture_rowid" integer,
	"quoteid" integer,
	"woid" varchar(15),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_sub_invoice_revisions" (
	"revision_id" serial PRIMARY KEY NOT NULL,
	"invoiceid" integer,
	"workordernumber" varchar(30),
	"created_time" timestamp,
	"revised_by_user" integer,
	"revision_type" varchar(45),
	"data_invoice" text,
	"data_fixtures" text,
	"data_parts" text,
	"data_soparts" text
);
--> statement-breakpoint
CREATE TABLE "tjx_subcontractor_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"partno" varchar(25) NOT NULL,
	"subid" integer NOT NULL,
	"installcostperunit" varchar(15)
);
--> statement-breakpoint
CREATE TABLE "tjx_wo_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(50) NOT NULL,
	"partno_used_infixutre" varchar(50),
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(7, 2),
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "tjx_wo_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(7, 2) NOT NULL,
	"sortorder" integer
);
--> statement-breakpoint
CREATE TABLE "localwo_cusprofile" (
	"id" serial PRIMARY KEY NOT NULL,
	"site" integer NOT NULL,
	"interior" text,
	"exterior" text,
	"mustnotes" text,
	"codes" text
);
--> statement-breakpoint
CREATE TABLE "localwo_hours" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"date" date NOT NULL,
	"timein" time NOT NULL,
	"timeout" time NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"numtechs" integer NOT NULL,
	"tech" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "localwo_hours_change_histroy" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fk_id" integer,
	"woid" integer,
	"date" date NOT NULL,
	"timein" time NOT NULL,
	"timeout" time NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"numtechs" integer NOT NULL,
	"tech" integer
);
--> statement-breakpoint
CREATE TABLE "localwo_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"tech" varchar(100) NOT NULL,
	"datetime" varchar(100) NOT NULL,
	"report" text NOT NULL,
	"hours" varchar(100) NOT NULL,
	"numtechs" varchar(100) NOT NULL,
	"parts" text,
	"soparts" text
);
--> statement-breakpoint
CREATE TABLE "localwo_sigs" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "localwo_techs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"date" timestamp,
	"tech" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wo_ajax_submit" (
	"id" serial PRIMARY KEY NOT NULL,
	"formdata" text,
	"woid" integer
);
--> statement-breakpoint
CREATE TABLE "wo_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"rate" smallint,
	"date" date NOT NULL,
	"hours" numeric(7, 2) NOT NULL,
	"hourly_rate" numeric(7, 2)
);
--> statement-breakpoint
CREATE TABLE "wo_images_cropped" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer,
	"cropped_time" timestamp
);
--> statement-breakpoint
CREATE TABLE "wo_invoiceno" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"invoiceno" varchar(120) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wo_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"user_id" integer NOT NULL,
	"notes" text,
	"title" varchar(100),
	"emails" varchar(100),
	"notes_type" varchar(30),
	"previous_status_id" integer,
	"status_id" integer,
	"is_public" smallint,
	"date_created" timestamp
);
--> statement-breakpoint
CREATE TABLE "wo_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"partno" varchar(50) NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(7, 2)
);
--> statement-breakpoint
CREATE TABLE "wo_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"report" text
);
--> statement-breakpoint
CREATE TABLE "wo_revisions" (
	"revision_id" serial PRIMARY KEY NOT NULL,
	"woid" integer,
	"created_time" timestamp,
	"revised_by_user" integer,
	"revision_type" varchar(45),
	"data_workorder" text,
	"data_wo_hours" text,
	"data_wo_localhours" text,
	"data_wo_parts" text,
	"data_wo_soparts" text,
	"data_wo_report" text,
	"data_wo_tax" text,
	"data_wo_notes" text,
	"is_last_revision" integer
);
--> statement-breakpoint
CREATE TABLE "wo_soparts" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"name" text NOT NULL,
	"qty" numeric(7, 2) NOT NULL,
	"price" numeric(7, 2) NOT NULL,
	"is_emergency_lighting" integer
);
--> statement-breakpoint
CREATE TABLE "wo_tax" (
	"id" serial PRIMARY KEY NOT NULL,
	"woid" integer NOT NULL,
	"tax" numeric(7, 2) NOT NULL,
	"name" varchar(5) NOT NULL,
	"tax_total" numeric(7, 2),
	"tax_gst" numeric(7, 2),
	"tax_pst" numeric(7, 2),
	"appliedtaxrate" varchar(15),
	"appliedtaxrate_pst" varchar(15),
	"appliedtaxrate_gst" varchar(15)
);
--> statement-breakpoint
CREATE TABLE "workorder" (
	"id" integer PRIMARY KEY NOT NULL,
	"site" integer NOT NULL,
	"servicetype" smallint NOT NULL,
	"priority" smallint NOT NULL,
	"dne" integer NOT NULL,
	"status" smallint NOT NULL,
	"datetaken" date NOT NULL,
	"expcompletion" date NOT NULL,
	"servicerequired" text NOT NULL,
	"notes" text,
	"subcontractor" integer,
	"completiondate" varchar(120),
	"securitycode" varchar(100),
	"customerpo" varchar(100),
	"local" smallint NOT NULL,
	"tech" integer,
	"tech_2" integer,
	"tech_labour_rate" numeric(7, 2),
	"invdate" date,
	"calc_inv_date" date,
	"customer" integer,
	"wo_folder_attach_path" varchar(200),
	"printed" varchar(10),
	"batched" date,
	"schannel" integer NOT NULL,
	"schannel_redone" integer,
	"sgsales_done" integer,
	"sgpurch_done" integer,
	"forced_enable_sc_transfer" integer,
	"ready_for_calc_timespan" bigint,
	"closeout_tech" integer,
	"closeout_tech_2" integer,
	"is_marked_red" integer,
	"is_marked_green" integer,
	"is_marked_critical" integer,
	"is_project_wo" smallint,
	"customer_quote_id" varchar(50),
	"is_tjx_quote" integer,
	"is_pma_order" smallint,
	"is_pma_bckup" varchar(12),
	"stock_updated" integer,
	"marked_invoiced_time" integer,
	"enable_sale_stock_upd_btn" integer,
	"only_portal_stock_updated" integer,
	"assigned_dispatch_id" integer,
	"pma_order_category" varchar(25),
	"primary_workorder" varchar(20),
	"add_to_local_modify_once" integer,
	"sc_primary_status" varchar(20),
	"sc_extended_status" varchar(20)
);
--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_permissions" ADD CONSTRAINT "user_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "app"."audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "app"."audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "app"."audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "app"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "permission_definitions_module_idx" ON "app"."permission_definitions" USING btree ("module");--> statement-breakpoint
CREATE INDEX "role_permissions_key_idx" ON "app"."role_permissions" USING btree ("permission_key");--> statement-breakpoint
CREATE INDEX "user_permissions_key_idx" ON "app"."user_permissions" USING btree ("permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "app"."users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "app"."users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_legacy_id_unique" ON "app"."users" USING btree ("legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_neon_user_id_unique" ON "app"."users" USING btree ("neon_user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "app"."users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "legacy_site_warranty_site_id" ON "site_warranty" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_customer_name" ON "customer" USING btree ("name");--> statement-breakpoint
CREATE INDEX "legacy_sites_id" ON "sites" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_users_username" ON "users" USING btree ("username","email");--> statement-breakpoint
CREATE INDEX "legacy_parts_number" ON "parts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "legacy_parts_inventory_adjustment_adjustment_type" ON "parts_inventory_adjustment" USING btree ("adjustment_type");--> statement-breakpoint
CREATE INDEX "legacy_parts_inventory_adjustment_partno" ON "parts_inventory_adjustment" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_parts_supplier_model_rates_part_code" ON "parts_supplier_model_rates" USING btree ("part_code");--> statement-breakpoint
CREATE INDEX "legacy_parts_supplier_model_rates_supplier_id" ON "parts_supplier_model_rates" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "legacy_parts_supplier_rates_part_code" ON "parts_supplier_rates" USING btree ("part_code");--> statement-breakpoint
CREATE INDEX "legacy_inv_parts_is_local_part" ON "inv_parts" USING btree ("is_local_part");--> statement-breakpoint
CREATE INDEX "legacy_inv_parts_partno" ON "inv_parts" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_inv_parts_woid" ON "inv_parts" USING btree ("woid");--> statement-breakpoint
CREATE INDEX "legacy_sc_inv_parts_is_local_part" ON "sc_inv_parts" USING btree ("is_local_part");--> statement-breakpoint
CREATE INDEX "legacy_sc_inv_parts_partno" ON "sc_inv_parts" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_sc_inv_parts_woid" ON "sc_inv_parts" USING btree ("woid");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_is_invoiced" ON "po_invoice" USING btree ("is_invoiced");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_poid" ON "po_invoice" USING btree ("poid");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_rgaid" ON "po_invoice" USING btree ("rgaid");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_sage_done" ON "po_invoice" USING btree ("sage_done");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_parts_invoice_id" ON "po_invoice_parts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_parts_partno" ON "po_invoice_parts" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_parts_poid" ON "po_invoice_parts" USING btree ("poid");--> statement-breakpoint
CREATE INDEX "legacy_po_invoice_parts_update_stock_quantity" ON "po_invoice_parts" USING btree ("update_stock_quantity");--> statement-breakpoint
CREATE INDEX "legacy_po_parts_item_purchase_type_number" ON "po_parts" USING btree ("item_purchase_type_number");--> statement-breakpoint
CREATE INDEX "legacy_po_parts_partno" ON "po_parts" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_po_parts_poid" ON "po_parts" USING btree ("poid");--> statement-breakpoint
CREATE INDEX "legacy_po_soparts_item_purchase_type_number" ON "po_soparts" USING btree ("item_purchase_type_number");--> statement-breakpoint
CREATE INDEX "legacy_po_soparts_name" ON "po_soparts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "legacy_po_soparts_poid" ON "po_soparts" USING btree ("poid");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_id" ON "purchaseorder" USING btree ("id");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_is_alliance_stocktransfer_po" ON "purchaseorder" USING btree ("is_alliance_stocktransfer_po");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_is_type_maintenance" ON "purchaseorder" USING btree ("is_type_maintenance");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_shipment_type" ON "purchaseorder" USING btree ("shipment_type");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_status" ON "purchaseorder" USING btree ("status");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_subcontractorid" ON "purchaseorder" USING btree ("subcontractorid");--> statement-breakpoint
CREATE INDEX "legacy_purchaseorder_supplier_id" ON "purchaseorder" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "legacy_rga_poid" ON "rga" USING btree ("poid");--> statement-breakpoint
CREATE INDEX "legacy_rga_replacement_type" ON "rga" USING btree ("replacement_type");--> statement-breakpoint
CREATE INDEX "legacy_rga_rga_type" ON "rga" USING btree ("rga_type");--> statement-breakpoint
CREATE INDEX "legacy_rga_status" ON "rga" USING btree ("status");--> statement-breakpoint
CREATE INDEX "legacy_rga_subcontractor" ON "rga" USING btree ("subcontractor");--> statement-breakpoint
CREATE INDEX "legacy_rga_supplier_id" ON "rga" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "legacy_rga_parts_partno" ON "rga_parts" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_rga_parts_po_number" ON "rga_parts" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "legacy_rga_parts_rgaid" ON "rga_parts" USING btree ("rgaid");--> statement-breakpoint
CREATE INDEX "legacy_rga_soparts_name" ON "rga_soparts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "legacy_calcquote_report_woid" ON "calcquote_report" USING btree ("woid");--> statement-breakpoint
CREATE INDEX "legacy_tjx_quote_lastused_sharedpart_quoteid" ON "tjx_quote_lastused_sharedpart" USING btree ("quoteid");--> statement-breakpoint
CREATE INDEX "legacy_tjx_subcontractor_rates_partno" ON "tjx_subcontractor_rates" USING btree ("partno");--> statement-breakpoint
CREATE INDEX "legacy_tjx_subcontractor_rates_subid" ON "tjx_subcontractor_rates" USING btree ("subid");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_wo_invoiceno_woid" ON "wo_invoiceno" USING btree ("woid");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_wo_report_woid" ON "wo_report" USING btree ("woid");--> statement-breakpoint
CREATE INDEX "legacy_wo_revisions_woid" ON "wo_revisions" USING btree ("woid");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_wo_tax_woid" ON "wo_tax" USING btree ("woid");--> statement-breakpoint
CREATE INDEX "legacy_workorder_local" ON "workorder" USING btree ("local");--> statement-breakpoint
CREATE INDEX "legacy_workorder_status" ON "workorder" USING btree ("status");--> statement-breakpoint
CREATE INDEX "legacy_workorder_subcontractor" ON "workorder" USING btree ("subcontractor");
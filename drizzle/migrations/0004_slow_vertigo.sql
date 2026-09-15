CREATE TABLE "order_number_counters" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "login_attempts_window_start_idx";--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_number_counters" ADD CONSTRAINT "order_number_counters_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_business_created_at_idx" ON "audit_logs" USING btree ("business_id","created_at","id");--> statement-breakpoint
CREATE INDEX "login_attempts_expires_at_idx" ON "login_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "modifier_recipe_lines_option_id_idx" ON "modifier_recipe_lines" USING btree ("modifier_option_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_recipe_id_idx" ON "recipe_lines" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_active_variant_version_idx" ON "recipes" USING btree ("menu_item_variant_id","version") WHERE "recipes"."active";--> statement-breakpoint
CREATE INDEX "purchases_business_purchase_date_idx" ON "purchases" USING btree ("business_id","purchase_date");--> statement-breakpoint
CREATE INDEX "inventory_movements_business_created_at_idx" ON "inventory_movements" USING btree ("business_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inventory_movements_ingredient_created_at_idx" ON "inventory_movements" USING btree ("ingredient_id","created_at");--> statement-breakpoint
CREATE INDEX "waste_records_business_created_at_idx" ON "waste_records" USING btree ("business_id","created_at","id");--> statement-breakpoint
CREATE INDEX "order_ingredient_consumption_order_id_idx" ON "order_ingredient_consumption" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_line_modifiers_order_line_id_idx" ON "order_line_modifiers" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_id_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_business_created_at_idx" ON "orders" USING btree ("business_id","created_at","id");--> statement-breakpoint
CREATE INDEX "print_jobs_order_created_at_idx" ON "print_jobs" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_order_request_key_idx" ON "print_jobs" USING btree ("order_id","request_key");--> statement-breakpoint
CREATE INDEX "print_jobs_attention_idx" ON "print_jobs" USING btree ("created_at") WHERE "print_jobs"."status" in ('FAILED', 'PROCESSING');--> statement-breakpoint
CREATE INDEX "expenses_business_expense_date_idx" ON "expenses" USING btree ("business_id","expense_date");
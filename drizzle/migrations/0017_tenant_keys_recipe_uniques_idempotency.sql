CREATE TABLE "request_idempotency" (
	"business_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_idempotency_business_id_operation_key_pk" PRIMARY KEY("business_id","operation","key")
);
--> statement-breakpoint
DROP INDEX "menu_item_modifier_groups_menu_item_id_idx";--> statement-breakpoint
DROP INDEX "recipes_active_variant_version_idx";--> statement-breakpoint
DROP INDEX "recipes_variant_id_idx";--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "request_idempotency" ADD CONSTRAINT "request_idempotency_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_idempotency_created_at_idx" ON "request_idempotency" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_item_modifier_groups_item_group_idx" ON "menu_item_modifier_groups" USING btree ("menu_item_id","modifier_group_id");--> statement-breakpoint
CREATE INDEX "menu_items_category_id_idx" ON "menu_items" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_one_active_per_variant_idx" ON "recipes" USING btree ("menu_item_variant_id") WHERE "recipes"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_variant_version_idx" ON "recipes" USING btree ("menu_item_variant_id","version");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_business_id_id_key" UNIQUE("business_id","id");
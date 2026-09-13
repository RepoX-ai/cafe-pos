ALTER TABLE "modifier_recipe_lines" DROP CONSTRAINT "modifier_recipe_lines_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe_lines" DROP CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_count_lines" DROP CONSTRAINT "stock_count_lines_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "waste_records" DROP CONSTRAINT "waste_records_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "order_ingredient_consumption" DROP CONSTRAINT "order_ingredient_consumption_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "purchase_lines" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_records" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_ingredient_consumption" ALTER COLUMN "ingredient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "ingredient_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "ingredient_base_unit_snapshot" "base_unit";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "ingredient_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "ingredient_base_unit_snapshot" "base_unit";--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD COLUMN "ingredient_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD COLUMN "ingredient_base_unit_snapshot" "base_unit";--> statement-breakpoint
ALTER TABLE "waste_records" ADD COLUMN "ingredient_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "waste_records" ADD COLUMN "ingredient_base_unit_snapshot" "base_unit";--> statement-breakpoint
ALTER TABLE "order_ingredient_consumption" ADD COLUMN "ingredient_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "order_ingredient_consumption" ADD COLUMN "ingredient_base_unit_snapshot" "base_unit";--> statement-breakpoint
ALTER TABLE "modifier_recipe_lines" ADD CONSTRAINT "modifier_recipe_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_ingredient_consumption" ADD CONSTRAINT "order_ingredient_consumption_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;
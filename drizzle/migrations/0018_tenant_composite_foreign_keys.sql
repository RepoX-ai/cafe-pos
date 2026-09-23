ALTER TABLE "ingredients" DROP CONSTRAINT "ingredients_preferred_supplier_id_suppliers_id_fk";
--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" DROP CONSTRAINT "menu_item_modifier_groups_menu_item_id_menu_items_id_fk";
--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" DROP CONSTRAINT "menu_item_modifier_groups_modifier_group_id_modifier_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "menu_items" DROP CONSTRAINT "menu_items_category_id_menu_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "modifier_recipe_lines" DROP CONSTRAINT "modifier_recipe_lines_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe_lines" DROP CONSTRAINT "recipe_lines_recipe_id_recipes_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe_lines" DROP CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk";
--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_supplier_id_suppliers_id_fk";
--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_preferred_supplier_same_business_fk" FOREIGN KEY ("business_id","preferred_supplier_id") REFERENCES "public"."suppliers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_item_same_business_fk" FOREIGN KEY ("business_id","menu_item_id") REFERENCES "public"."menu_items"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_group_same_business_fk" FOREIGN KEY ("business_id","modifier_group_id") REFERENCES "public"."modifier_groups"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_same_business_fk" FOREIGN KEY ("business_id","category_id") REFERENCES "public"."menu_categories"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_recipe_lines" ADD CONSTRAINT "modifier_recipe_lines_ingredient_same_business_fk" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "public"."ingredients"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipe_same_business_fk" FOREIGN KEY ("business_id","recipe_id") REFERENCES "public"."recipes"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_same_business_fk" FOREIGN KEY ("business_id","ingredient_id") REFERENCES "public"."ingredients"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_same_business_fk" FOREIGN KEY ("business_id","supplier_id") REFERENCES "public"."suppliers"("business_id","id") ON DELETE no action ON UPDATE no action;
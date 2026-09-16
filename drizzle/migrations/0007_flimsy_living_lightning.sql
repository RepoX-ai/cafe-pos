CREATE TYPE "public"."ingredient_display_unit" AS ENUM('kg', 'g', 'L', 'ml', 'pc');--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "display_unit" "ingredient_display_unit";
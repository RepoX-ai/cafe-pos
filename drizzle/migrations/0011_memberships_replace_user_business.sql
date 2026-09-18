ALTER TABLE "user_roles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user_roles" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_business_id_businesses_id_fk";
--> statement-breakpoint
DROP INDEX "users_business_id_idx";--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "active_membership_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "modifier_recipe_lines" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_lines" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "print_jobs" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "business_id";
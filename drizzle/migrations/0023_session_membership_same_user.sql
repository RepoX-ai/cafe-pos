ALTER TABLE "sessions" DROP CONSTRAINT "sessions_active_membership_id_memberships_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_same_user_fk" FOREIGN KEY ("active_membership_id","user_id") REFERENCES "public"."memberships"("id","user_id") ON DELETE cascade ON UPDATE no action;
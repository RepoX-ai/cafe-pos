ALTER TABLE "purchases" ADD COLUMN "paid_at" date;
CREATE INDEX "purchases_business_paid_at_idx" ON "purchases" ("business_id", "paid_at") WHERE "paid_at" IS NOT NULL;

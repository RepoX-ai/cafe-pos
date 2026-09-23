-- Custom SQL migration file, put your code below! --
-- Order-number search (substring ILIKE) uses a trigram index; see
-- orders_order_number_trgm_idx in the next migration. pg_trgm is a trusted
-- extension, so the database owner can create it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

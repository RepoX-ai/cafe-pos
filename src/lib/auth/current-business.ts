import "server-only";
import { cache } from "react";
import { db } from "@/lib/db/client";
import { getBusinessById } from "@/server/services/business-service";

/**
 * The business row for the current request, fetched once.
 *
 * The dashboard layout needs it for the shell (name, logo, accent) and
 * several pages need it again for their own settings. Without this, one
 * page load ran the same SELECT twice. Same memoisation model as
 * `getCurrentUser`: one server render only, never shared across requests.
 */
export const getCurrentBusiness = cache(async (businessId: string) => getBusinessById(db, businessId));

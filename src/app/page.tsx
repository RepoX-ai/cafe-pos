import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCashierOnly } from "@/lib/auth/guards";

/**
 * Role-aware landing route (PRD §10): cashiers land on the POS, everyone
 * else lands on the dashboard. Unauthenticated visitors go to /login.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  redirect(isCashierOnly(user) ? "/pos" : "/dashboard");
}

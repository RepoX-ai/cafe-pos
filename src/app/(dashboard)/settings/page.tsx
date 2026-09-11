import type { Metadata } from "next";
import Link from "next/link";
import { Users, History } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { getBusinessById } from "@/server/services/business-service";
import { parseTaxConfig } from "@/lib/settings/tax";
import { SettingsForm } from "./settings-form";
import { PrinterSection } from "./printer-section";

export const metadata: Metadata = {
  title: "Settings — CaféOps",
};

export default async function SettingsPage() {
  const user = await requirePageAccess("settings:write");
  const business = await getBusinessById(db, user.businessId);
  if (!business) return null;

  const tax = parseTaxConfig(business.taxConfig);

  return (
    <div className="mx-auto max-w-[700px] px-8 py-10">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Settings</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Business details, tax, service charge, and inventory behavior.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {hasAnyRolePermission(user.roles, "staff:write") ? (
          <Link
            href="/settings/staff"
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent-primary)]"
          >
            <Users size={18} className="text-[var(--color-accent-primary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Staff</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Create accounts, assign roles, deactivate staff.</p>
            </div>
          </Link>
        ) : null}
        {hasAnyRolePermission(user.roles, "audit:read") ? (
          <Link
            href="/settings/audit"
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent-primary)]"
          >
            <History size={18} className="text-[var(--color-accent-primary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Audit log</p>
              <p className="text-xs text-[var(--color-text-secondary)]">Review recorded staff and system actions.</p>
            </div>
          </Link>
        ) : null}
        <PrinterSection providerName={process.env.PRINT_PROVIDER || "mock"} />
        <SettingsForm
          business={{
            name: business.name,
            receiptFooter: business.receiptFooter,
            orderNumberPrefix: business.orderNumberPrefix,
            allowNegativeStock: business.allowNegativeStock,
          }}
          tax={tax}
          serviceChargePercent={business.serviceChargePercent ? Number(business.serviceChargePercent) : null}
        />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
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
    <div className="mx-auto max-w-[700px]">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Settings</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Business details, tax, service charge, and inventory behavior.
      </p>

      <div className="mt-8 flex flex-col gap-6">
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

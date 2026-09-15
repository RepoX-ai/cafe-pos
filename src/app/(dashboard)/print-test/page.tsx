import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { PrintTestClient } from "./print-test-client";

export const metadata: Metadata = {
  title: "Printer test — CaféOps",
};

/**
 * Bluetooth diagnostics for the café's thermal printer. Deliberately a
 * separate page from Settings: it only works on the Android tablet that is
 * paired with the printer, and it exists to tune chunk size / timing
 * against real hardware and to report back what happened.
 */
export default async function PrintTestPage() {
  await requirePageAccess("printer:manage");

  return (
    <div className="mx-auto max-w-[1100px]">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Printer test</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-[var(--color-text-secondary)]">
        Open this page on the Android tablet in Chrome, over HTTPS. Turn the printer on, tap{" "}
        <strong>Connect printer</strong> and choose <code className="text-xs">RPP02N</code>, then print a sample
        receipt. Bluetooth printing does not work in Safari or on iPad.
      </p>

      <div className="mt-8">
        <PrintTestClient />
      </div>
    </div>
  );
}

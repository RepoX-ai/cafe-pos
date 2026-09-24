"use client";

import { useActionState, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useActionResultToast } from "@/components/ui/use-action-toast";
import { importMenuCsvAction, type ImportMenuCsvResult } from "./bulk-actions";

/**
 * Bulk update: download the catalog as CSV, edit it in a spreadsheet, and
 * upload it back. Export is available to anyone who can see the /menu page
 * (menu:read); import still needs menu:write (and recipes:write if the file
 * carries recipe lines — enforced server-side, not gated here).
 */
export function MenuBulkCsv({ canWrite }: { canWrite: boolean }) {
  const [importing, setImporting] = useState(false);

  return (
    <>
      <a href="/api/exports/menu" className={buttonVariants({ variant: "secondary" })}>
        <Download size={15} />
        Export CSV
      </a>
      {canWrite ? (
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <Upload size={15} />
          Import CSV
        </Button>
      ) : null}

      <Modal open={importing} onClose={() => setImporting(false)} title="Import menu CSV" maxWidthClassName="max-w-[560px]">
        <ImportForm onDone={() => setImporting(false)} />
      </Modal>
    </>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<ImportMenuCsvResult | undefined, FormData>(importMenuCsvAction, undefined);
  const [key] = useState(() => (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())));
  const [fileName, setFileName] = useState<string | null>(null);
  useActionResultToast(state, state && state.ok ? state.summary : "Imported.");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Upload a CSV exported from this page, edited in a spreadsheet. Leave{" "}
        <code className="rounded bg-[var(--color-page-bg)] px-1 py-0.5 text-xs">item_id</code> and{" "}
        <code className="rounded bg-[var(--color-page-bg)] px-1 py-0.5 text-xs">variant_id</code> blank on a row to create a new
        item or variant; keep the exported value to update the one it came from. The whole file is applied together — if any row
        is invalid, nothing is saved.
      </p>

      <input type="hidden" name="idempotencyKey" value={key} />
      <input
        id="menu-csv-file"
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
        className="peer sr-only"
      />
      <div className="flex h-10 w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-1.5 pr-2 peer-focus-visible:border-[var(--color-accent-primary)]">
        <label
          htmlFor="menu-csv-file"
          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] bg-[var(--color-page-bg)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-border)]"
        >
          <Upload size={14} aria-hidden="true" />
          {fileName ? "Change" : "Choose file"}
        </label>
        <span className={`min-w-0 flex-1 truncate text-sm ${fileName ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}`}>
          {fileName ?? "No file chosen"}
        </span>
      </div>

      {state && !state.ok ? (
        <div role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          <p>{state.error}</p>
          {state.rowErrors && state.rowErrors.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {state.rowErrors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {state && state.ok ? (
        <p className="rounded-[var(--radius-sm)] bg-[var(--color-success-bg)] px-3 py-2 text-sm text-[var(--color-success)]">{state.summary}</p>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {state?.ok ? "Close" : "Cancel"}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Importing…" : "Import"}
        </Button>
      </div>
    </form>
  );
}

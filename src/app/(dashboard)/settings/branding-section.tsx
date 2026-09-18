"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { useToast } from "@/components/ui/toast";
import { accentTokens, meetsAaOnAccent, normalizeHexColor } from "@/lib/branding/branding";
import { prepareLogoUpload } from "@/lib/branding/raster-browser";
import { formatBytes } from "@/lib/images/prepare-image";
import { updateBrandingAction } from "./actions";

export interface BrandingValues {
  logoUrl: string | null;
  brandColor: string | null;
  hasReceiptLogo: boolean;
}

const DEFAULT_ACCENT = "#a5502b";

/**
 * Logo and accent colour for the business currently being worked in.
 *
 * The receipt copy of the logo is produced here, in the browser, at the
 * moment the file is chosen: a canvas dithers it to the 1-bit raster the
 * thermal printer takes, and the packed bytes ride along with the form.
 * That keeps image decoding out of the server entirely and lets the owner
 * see exactly what will print before saving.
 */
export function BrandingSection({ branding }: { branding: BrandingValues }) {
  const [isPending, setIsPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const showToast = useToast();

  const [color, setColor] = useState(branding.brandColor ?? DEFAULT_ACCENT);
  const [logoPreview, setLogoPreview] = useState<string | null>(branding.logoUrl);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [raster, setRaster] = useState<{ base64: string; width: number; height: number } | null>(null);
  const [rasterError, setRasterError] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [savings, setSavings] = useState<{ from: number; to: number } | null>(null);
  // The downscaled, re-encoded file that actually gets uploaded — never
  // the raw one the owner picked, which can be many megabytes.
  const uploadRef = useRef<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const normalized = normalizeHexColor(color);
  const preview = normalized ? accentTokens(normalized) : null;
  const lowContrast = Boolean(normalized) && !meetsAaOnAccent(normalized!);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRasterError(null);
    setReceiptPreview(null);
    setRaster(null);
    setFieldErrors({});
    uploadRef.current = null;
    if (!file) return;

    setRemoveLogo(false);
    setPreparing(true);
    const result = await prepareLogoUpload(file);
    setPreparing(false);
    if (!result.ok) {
      setFieldErrors({ logoFile: result.error });
      showToast("error", result.error);
      return;
    }

    uploadRef.current = result.logo.file;
    setSavings({ from: result.logo.originalBytes, to: result.logo.bytes });
    setLogoPreview(result.logo.displayUrl);
    setRaster(result.logo.raster);
    setReceiptPreview(result.logo.previewDataUrl);
    // The on-screen logo still saves; only the receipt copy is missing.
    setRasterError(result.logo.rasterError);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preparing) return;
    setIsPending(true);
    setFieldErrors({});

    const form = new FormData();
    form.set("brandColor", color);
    form.set("removeLogo", removeLogo ? "on" : "");
    if (uploadRef.current) form.set("logoFile", uploadRef.current);
    if (raster) {
      form.set("logoRasterBase64", raster.base64);
      form.set("logoRasterWidth", String(raster.width));
      form.set("logoRasterHeight", String(raster.height));
    }

    const result = await updateBrandingAction(form);
    if (!result.ok) {
      setIsPending(false);
      setFieldErrors(result.fieldErrors ?? {});
      showToast("error", result.error);
      return;
    }
    // A full load rather than an RSC refresh: the logo and accent live in
    // the shell above this page, and re-rendering that tree on the client
    // is what makes React trip over next-themes' inline <script>.
    window.location.reload();
  }

  function clearLogo() {
    uploadRef.current = null;
    setSavings(null);
    setRemoveLogo(true);
    setLogoPreview(null);
    setReceiptPreview(null);
    setRaster(null);
    setRasterError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form onSubmit={submit} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Branding</h2>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        The logo and accent colour for this business only. Each business you run keeps its own, so a restaurant and a
        coffee shop don&apos;t have to look alike.
      </p>

      <div className="flex flex-col gap-5">
        <Field label="Logo" htmlFor="logoFile" error={fieldErrors.logoFile}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-40 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-page-bg)] p-2">
              {logoPreview ? (
                <img src={logoPreview} alt="Current logo" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-[var(--color-text-muted)]">No logo</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                id="logoFile"
                name="logoFile"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFileChange}
                className="text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--color-border)] file:bg-[var(--color-surface)] file:px-3 file:py-1.5 file:text-sm"
              />
              {logoPreview ? (
                <button
                  type="button"
                  onClick={clearLogo}
                  className="self-start text-xs font-medium text-[var(--color-danger)] hover:underline"
                >
                  Remove logo
                </button>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {preparing
              ? "Preparing…"
              : savings
                ? `Resized and converted to WebP: ${formatBytes(savings.from)} → ${formatBytes(savings.to)}.`
                : "PNG, JPG or WebP. Large images are resized and compressed in your browser before upload, so a photo straight off a phone is fine."}
          </p>
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium text-[var(--color-text-primary)]">Receipt logo</p>
          {receiptPreview ? (
            <div className="flex flex-wrap items-center gap-3">
              <img
                src={receiptPreview}
                alt="How the logo will print on a receipt"
                className="max-h-24 border border-[var(--color-border)] bg-white object-contain p-1"
              />
              <p className="text-xs text-[var(--color-text-muted)]">
                Exactly how it prints: {raster?.width} × {raster?.height} dots, black and white only.
              </p>
            </div>
          ) : rasterError ? (
            <p className="text-xs text-[var(--color-warning)]">
              {rasterError} The logo will still appear on screen; receipts keep printing the business name.
            </p>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              {branding.hasReceiptLogo
                ? "A receipt copy is saved. Choose a new logo to replace it."
                : "Choose a logo above and a black-and-white preview of the printed version appears here."}
            </p>
          )}

        </div>

        <Field label="Accent colour" htmlFor="brandColor" error={fieldErrors.brandColor}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick accent colour"
              value={normalized ?? DEFAULT_ACCENT}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
            />
            <input
              id="brandColor"
              name="brandColor"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              spellCheck={false}
              className={`${inputClassName} max-w-[10rem] font-mono`}
            />
            {preview ? (
              <span
                className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-medium"
                style={{ backgroundColor: preview.primary, color: preview.contrast }}
              >
                Buttons
              </span>
            ) : null}
          </div>
          {lowContrast ? (
            <p className="mt-2 text-xs text-[var(--color-warning)]">
              Text on this colour is below the 4.5:1 contrast minimum for body text. It will still be used — a darker or
              lighter shade would read better.
            </p>
          ) : null}
        </Field>
      </div>

      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={isPending || preparing}>
          {isPending ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </form>
  );
}

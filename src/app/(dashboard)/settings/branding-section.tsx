"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { useActionResultToast } from "@/components/ui/use-action-toast";
import { accentTokens, meetsAaOnAccent, normalizeHexColor } from "@/lib/branding/branding";
import { rasterizeLogoFile } from "@/lib/branding/raster-browser";
import { updateBrandingAction, type BrandingActionState } from "./actions";

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
  const [state, formAction, isPending] = useActionState<BrandingActionState, FormData>(
    updateBrandingAction,
    undefined,
  );
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Branding saved.");

  const [color, setColor] = useState(branding.brandColor ?? DEFAULT_ACCENT);
  const [logoPreview, setLogoPreview] = useState<string | null>(branding.logoUrl);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [raster, setRaster] = useState<{ base64: string; width: number; height: number } | null>(null);
  const [rasterError, setRasterError] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const normalized = normalizeHexColor(color);
  const preview = normalized ? accentTokens(normalized) : null;
  const lowContrast = Boolean(normalized) && !meetsAaOnAccent(normalized!);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRasterError(null);
    setReceiptPreview(null);
    setRaster(null);
    if (!file) return;

    setRemoveLogo(false);
    setLogoPreview(URL.createObjectURL(file));

    const result = await rasterizeLogoFile(file);
    if (!result.ok) {
      // The on-screen logo still saves; only the receipt copy is missing.
      setRasterError(result.error);
      return;
    }
    setRaster(result.raster);
    setReceiptPreview(result.previewDataUrl);
  }

  function clearLogo() {
    setRemoveLogo(true);
    setLogoPreview(null);
    setReceiptPreview(null);
    setRaster(null);
    setRasterError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form action={formAction} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Branding</h2>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        The logo and accent colour for this business only. Each business you run keeps its own, so a restaurant and a
        coffee shop don&apos;t have to look alike.
      </p>

      <div className="flex flex-col gap-5">
        <Field label="Logo" htmlFor="logoFile" error={errorState?.fieldErrors?.logoFile}>
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
          <input type="hidden" name="removeLogo" value={removeLogo ? "on" : ""} />
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            PNG, JPG or WebP, up to 3MB. A wide wordmark on a transparent or white background works best.
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
          {raster ? (
            <>
              <input type="hidden" name="logoRasterBase64" value={raster.base64} />
              <input type="hidden" name="logoRasterWidth" value={raster.width} />
              <input type="hidden" name="logoRasterHeight" value={raster.height} />
            </>
          ) : null}
        </div>

        <Field label="Accent colour" htmlFor="brandColor" error={errorState?.fieldErrors?.brandColor}>
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
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </form>
  );
}

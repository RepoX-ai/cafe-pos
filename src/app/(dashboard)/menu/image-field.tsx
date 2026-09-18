"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { formatBytes, prepareImageUpload, setInputFile, type PreparedImage } from "@/lib/images/prepare-image";

/**
 * Shared "Image" field for the menu item create/edit forms: a tab toggle
 * between pasting a URL and uploading a file, with a live preview.
 *
 * When switched to "Upload" without picking a file yet, the existing
 * `imageUrl` is still submitted via a hidden input so nothing gets cleared
 * — only choosing a file, or typing in the URL tab, changes the image.
 * The server action (resolveImageUrl in actions.ts) prefers an uploaded
 * file over the URL field when both are present.
 *
 * A chosen file is resized and re-encoded to WebP in the browser, and the
 * input's own FileList is swapped for that smaller copy — so this plain
 * `<form action={...}>` submits the compressed image without the form
 * knowing anything about it. A 3MB phone photo becomes a couple of hundred
 * kilobytes, which is the difference between a café's menu costing
 * megabytes or gigabytes on a small VPS disk.
 */

/** Big enough for a full-bleed menu photo on a retina tablet. */
const MENU_IMAGE_MAX_EDGE = 1200;
export function ImageField({
  defaultUrl,
  error,
  disabled,
}: {
  defaultUrl?: string | null;
  error?: string;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"url" | "upload">(defaultUrl ? "url" : "upload");
  const [urlValue, setUrlValue] = useState(defaultUrl ?? "");
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // Tracks which preview source last failed to load, rather than a plain
  // boolean, so switching sources doesn't carry a stale error forward.
  const [erroredPreview, setErroredPreview] = useState<string | null>(null);

  const objectUrl = prepared?.previewUrl ?? null;
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  function clearFile() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPrepared(null);
    setPrepareError(null);
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const chosen = input.files?.[0] ?? null;
    setPrepareError(null);
    setPrepared(null);
    if (!chosen) return;

    setPreparing(true);
    const result = await prepareImageUpload(chosen, {
      maxWidth: MENU_IMAGE_MAX_EDGE,
      maxHeight: MENU_IMAGE_MAX_EDGE,
    });
    setPreparing(false);

    if (!result.ok) {
      // Leave the original in the input: the server still enforces its own
      // size and format checks, so a browser that cannot process the image
      // is not blocked from uploading a reasonable one.
      setPrepareError(result.error);
      return;
    }
    // If the swap fails (very old browser), the original file is still in
    // the input and uploads as before — just larger.
    setInputFile(input, result.image.file);
    setPrepared(result.image);
  }

  const preview = mode === "upload" ? objectUrl : urlValue || null;
  const previewError = preview !== null && preview === erroredPreview;

  return (
    <Field label="Image" htmlFor="imageUrl" error={error}>
      <div className="flex items-start gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-page-bg)]">
          {preview && !previewError ? (
            // Both pasted URLs (arbitrary external hosts) and uploaded files
            // (object URLs / local paths) go through a plain <img>, not
            // next/image, to avoid fighting the remote-patterns allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setErroredPreview(preview)}
              onLoad={() => setErroredPreview(null)}
            />
          ) : (
            <span className="text-[10px] text-[var(--color-text-muted)]">No image</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex gap-1">
            {(["url", "upload"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m)}
                className={`rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium transition-colors ${
                  mode === m
                    ? "bg-[var(--color-accent-primary)] text-[var(--color-accent-contrast)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {m === "url" ? "Paste URL" : "Upload file"}
              </button>
            ))}
          </div>

          {mode === "url" ? (
            <input
              id="imageUrl"
              name="imageUrl"
              type="text"
              inputMode="url"
              placeholder="https://…"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              disabled={disabled}
              className={`${inputClassName} w-full`}
            />
          ) : (
            <>
              <input type="hidden" name="imageUrl" value={urlValue} />
              {/* The native file input can't be styled consistently across
                  browsers, so it stays visually hidden (still focusable and
                  submitted with the form) behind a styled label. */}
              <input
                ref={fileInputRef}
                id="imageFile"
                name="imageFile"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled}
                onChange={onFileChange}
                className="peer sr-only"
              />
              <div className="flex h-10 w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-1.5 pr-2 peer-focus-visible:border-[var(--color-accent-primary)]">
                <label
                  htmlFor="imageFile"
                  className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] bg-[var(--color-page-bg)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-border)] ${
                    disabled ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }`}
                >
                  <Upload size={14} aria-hidden="true" />
                  {prepared ? "Change" : "Choose image"}
                </label>
                <span className={`min-w-0 flex-1 truncate text-sm ${prepared ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}`}>
                  {preparing ? "Compressing…" : prepared ? prepared.file.name : "No file chosen"}
                </span>
                {prepared ? (
                  <button
                    type="button"
                    onClick={clearFile}
                    disabled={disabled}
                    aria-label="Remove chosen file"
                    className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            </>
          )}

          {previewError && preview ? (
            <p className="mt-1 text-xs text-[var(--color-danger)]">Couldn&apos;t load that image — the cashier will see the name only.</p>
          ) : prepareError ? (
            <p className="mt-1 text-xs text-[var(--color-warning)]">{prepareError}</p>
          ) : prepared?.recompressed ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Resized to {prepared.width}×{prepared.height} and compressed: {formatBytes(prepared.originalBytes)} →{" "}
              {formatBytes(prepared.bytes)}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {mode === "upload"
                ? "JPG, PNG, or WebP. Large photos are resized and compressed in your browser before upload."
                : "Shown on the POS grid so cashiers can spot items faster."}
            </p>
          )}
        </div>
      </div>
    </Field>
  );
}

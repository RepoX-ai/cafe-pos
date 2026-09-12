"use client";

import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";

/**
 * Shared "Image" field for the menu item create/edit forms: a tab toggle
 * between pasting a URL and uploading a file, with a live preview.
 *
 * When switched to "Upload" without picking a file yet, the existing
 * `imageUrl` is still submitted via a hidden input so nothing gets cleared
 * — only choosing a file, or typing in the URL tab, changes the image.
 * The server action (resolveImageUrl in actions.ts) prefers an uploaded
 * file over the URL field when both are present.
 */
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
  const [file, setFile] = useState<File | null>(null);
  // Tracks which preview source last failed to load, rather than a plain
  // boolean, so switching sources doesn't carry a stale error forward.
  const [erroredPreview, setErroredPreview] = useState<string | null>(null);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

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
              className={inputClassName}
            />
          ) : (
            <>
              <input type="hidden" name="imageUrl" value={urlValue} />
              <input
                id="imageFile"
                name="imageFile"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={disabled}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={`${inputClassName} cursor-pointer file:mr-3 file:cursor-pointer file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--color-page-bg)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--color-text-primary)]`}
              />
            </>
          )}

          {previewError && preview ? (
            <p className="mt-1 text-xs text-[var(--color-danger)]">Couldn&apos;t load that image — the cashier will see the name only.</p>
          ) : (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {mode === "upload" ? "JPG, PNG, or WebP, up to 3MB." : "Shown on the POS grid so cashiers can spot items faster."}
            </p>
          )}
        </div>
      </div>
    </Field>
  );
}

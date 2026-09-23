"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

const SIZE_CLASS = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
} as const;

/**
 * Square menu-item photo with an icon placeholder when there's no image or
 * it fails to load. Product photos are pasted external URLs, not a fixed set
 * of remote hosts, so next/image's remotePatterns allowlist doesn't fit.
 */
export function ItemThumbnail({
  imageUrl,
  name,
  size = "md",
}: {
  imageUrl: string | null;
  name: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  const [failed, setFailed] = useState(false);
  const box = `${SIZE_CLASS[size]} shrink-0 rounded-[var(--radius-sm)]`;

  if (!imageUrl || failed) {
    return (
      <div className={`${box} flex items-center justify-center bg-[var(--color-page-bg)]`}>
        <ImageOff size={14} className="text-[var(--color-text-muted)]" aria-hidden="true" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={name} loading="lazy" decoding="async" className={`${box} object-cover`} onError={() => setFailed(true)} />
  );
}

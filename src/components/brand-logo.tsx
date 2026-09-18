/* eslint-disable @next/next/no-img-element */

/**
 * The logo in the app shell and the POS header.
 *
 * With `src` set it renders that business's own uploaded logo. Businesses
 * are independent tenants that may be a restaurant and a coffee shop, so
 * one baked-in wordmark cannot serve them all.
 *
 * The dark-mode invert filter is applied only to the bundled wordmark. An
 * uploaded logo is the owner's artwork in their own colours, and inverting
 * it would wreck it — those render as-is.
 *
 * A plain <img> rather than next/image, matching how menu photos are
 * rendered elsewhere: the bundled asset is a 37KB static file under
 * public/, so optimisation buys nothing, and keeping next/image out of the
 * path keeps the docker/VPS deploy free of an image-optimiser dependency
 * (PRD rule 10).
 *
 * Callers set the height (`h-9`, `h-14`, …); width follows the aspect ratio.
 */
export function BrandLogo({
  className = "h-8",
  alt = "Matsudon",
  src,
}: {
  className?: string;
  alt?: string;
  /** The business's own logo URL; falls back to the bundled wordmark. */
  src?: string | null;
}) {
  const custom = Boolean(src);
  return (
    <img
      src={src || "/images/brand/matsudon-logo.png"}
      alt={alt}
      {...(custom ? {} : { width: 382, height: 159 })}
      className={`w-auto shrink-0 object-contain ${className}`}
      style={custom ? undefined : { filter: "var(--brand-logo-filter)" }}
    />
  );
}

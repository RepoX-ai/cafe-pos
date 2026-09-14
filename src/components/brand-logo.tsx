/* eslint-disable @next/next/no-img-element */

/**
 * The Matsudon wordmark. A plain <img> rather than next/image, matching how
 * menu photos are rendered elsewhere in the app — the asset is a 37KB static
 * file under public/, so optimisation buys nothing, and keeping next/image out
 * of the path keeps the docker/VPS deploy free of an image-optimiser
 * dependency (PRD rule 10).
 *
 * Callers set the height (`h-9`, `h-14`, …); width follows the aspect ratio.
 * `alt` takes the business name where one is already loaded, so a renamed
 * business is still announced correctly.
 */
export function BrandLogo({
  className = "h-8",
  alt = "Matsudon",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/images/brand/matsudon-logo.png"
      alt={alt}
      width={382}
      height={159}
      className={`w-auto shrink-0 object-contain ${className}`}
      style={{ filter: "var(--brand-logo-filter)" }}
    />
  );
}

/* eslint-disable @next/next/no-img-element */

/**
 * The logo in the app shell, the POS header and the login page.
 *
 * Three cases, in order:
 *
 *  1. `src` — the business's own uploaded logo.
 *  2. `name` with no `src` — a generated placeholder: the business's
 *     initials on its own accent colour, next to its name.
 *  3. neither — the Café POS mark, for the login page, where no session
 *     exists yet so the tenant is unknown.
 *
 * The placeholder is drawn rather than shipped as a file on purpose.
 * Businesses here are independent tenants — one is a coffee shop, another
 * a restaurant — so no single stock image is right for all of them, and a
 * generated monogram picks up whatever accent colour each business chose.
 *
 * A plain <img> for the uploaded case rather than next/image, matching how
 * menu photos are rendered elsewhere, which keeps the docker/VPS deploy
 * free of an image-optimiser dependency (PRD rule 10).
 *
 * Callers set the height (`h-8`, `h-9`, `h-20`); everything scales from it.
 */

/**
 * Up to two letters for the monogram: the first letter of the first and
 * last words, or the first two letters of a single word. Uses code points,
 * so an emoji or a non-Latin name yields one whole character rather than
 * half a surrogate pair.
 */
export function businessInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0]);
  if (words.length === 1) return first.slice(0, 2).join("").toUpperCase();
  const last = Array.from(words[words.length - 1]);
  return (first[0] + last[0]).toUpperCase();
}

/** The monogram tile on its own — square, scales to the given height. */
function Monogram({ name }: { name: string }) {
  const initials = businessInitials(name);
  return (
    <svg viewBox="0 0 40 40" className="h-full w-auto shrink-0" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="var(--color-accent-primary)" />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--color-accent-contrast)"
        fontSize={initials.length > 1 ? 17 : 21}
        fontWeight={600}
        letterSpacing="0.5"
      >
        {initials}
      </text>
    </svg>
  );
}

/**
 * The product mark, used only where no business is known (the login
 * screen, mainly). A cup here is fine — unlike the per-business
 * Monogram above, this one stands for Café POS itself, not any one
 * tenant's business.
 */
function AppMark() {
  return (
    <svg viewBox="0 0 40 40" className="h-full w-auto shrink-0" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="var(--color-accent-primary)" />
      <g
        transform="translate(7.5, 10.5) scale(1.1)"
        fill="none"
        stroke="var(--color-accent-contrast)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
        <path d="M6 2v2M10 2v2M14 2v2" />
      </g>
    </svg>
  );
}

export function BrandLogo({
  className = "h-8",
  textClassName = "text-[0.95rem]",
  gapClassName = "gap-2",
  alt,
  src,
  name,
  markOnly = false,
}: {
  className?: string;
  /** Font size for the business/product name; independent of the icon's height. */
  textClassName?: string;
  /** Gap between the icon and the name. */
  gapClassName?: string;
  alt?: string;
  /** The business's own logo URL. */
  src?: string | null;
  /** Business name, for the generated placeholder when there is no `src`. */
  name?: string | null;
  /** Drop the name from the placeholder, where the caller already shows it. */
  markOnly?: boolean;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt ?? name ?? "Logo"}
        className={`w-auto shrink-0 object-contain ${className}`}
      />
    );
  }

  const label = alt ?? name ?? "Café POS";

  return (
    <span role="img" aria-label={label} className={`flex items-center ${gapClassName} ${className}`}>
      {name ? <Monogram name={name} /> : <AppMark />}
      {markOnly ? null : (
        <span className={`truncate font-semibold tracking-tight text-[var(--color-text-primary)] ${textClassName}`}>
          {name ?? "Café POS"}
        </span>
      )}
    </span>
  );
}

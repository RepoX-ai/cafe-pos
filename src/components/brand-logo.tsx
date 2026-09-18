/* eslint-disable @next/next/no-img-element */

/**
 * The logo in the app shell, the POS header and the login page.
 *
 * Three cases, in order:
 *
 *  1. `src` — the business's own uploaded logo.
 *  2. `name` with no `src` — a generated placeholder: the business's
 *     initials on its own accent colour, next to its name.
 *  3. neither — the CaféOps mark, for the login page, where no session
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
 * The product mark, used only where no business is known. Deliberately
 * abstract — a cup would be wrong for the restaurant, a plate wrong for
 * the coffee shop.
 */
function AppMark() {
  return (
    <svg viewBox="0 0 40 40" className="h-full w-auto shrink-0" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="var(--color-accent-primary)" />
      <path
        d="M13 14.5h14M13 20h14M13 25.5h9"
        stroke="var(--color-accent-contrast)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandLogo({
  className = "h-8",
  alt,
  src,
  name,
  markOnly = false,
}: {
  className?: string;
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

  const label = alt ?? name ?? "CaféOps";

  return (
    <span role="img" aria-label={label} className={`flex items-center gap-2 ${className}`}>
      {name ? <Monogram name={name} /> : <AppMark />}
      {markOnly ? null : (
        <span className="truncate text-[0.95rem] font-semibold tracking-tight text-[var(--color-text-primary)]">
          {name ?? "CaféOps"}
        </span>
      )}
    </span>
  );
}

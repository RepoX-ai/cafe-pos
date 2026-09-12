# Matsudon menu photos

Twelve WebP crops from the supplied IMG_9212.jpeg menu board are bundled in
`public/images/menu/matsudon/`. The board was rotated and its skew corrected
before cropping. These are small source photos suitable for thumbnails;
the spicy badges remain part of the printed photos. The fries crop excludes
the nearby flavor text and the top of the basket handle.

`scripts/matsudon-menu-images.ts` matches all 14 seeded item names exactly.
Taiyaki Coklat, Taiyaki Biscoff, and Taiyaki Mix share the board's single
Taiyaki photo. No separate flavor photos were invented.

New menu imports include the photos automatically. For an already-seeded
database, deploy this code and the public assets, then run from the project root:

```bash
npm run db:backfill:matsudon-images
npm run db:backfill:matsudon-images -- --apply
```

The first command previews. The second saves in a transaction. Both require
`DATABASE_URL`. If more than one business exists, set `MENU_SEED_BUSINESS_ID`
to the intended business UUID. The command matches both name and category,
keeps existing nonblank images, reports missing items, and rolls back on
duplicate matches. It does not change prices, variants, recipes, or stock.
No schema migration is required. Do not rerun the full menu seed to backfill
images: that seed skips an existing menu.

The existing Docker image copies `public/` and `scripts/`, so this command
also works as `docker compose run --rm app npm run db:backfill:matsudon-images -- --apply`.

Local validation: crops visually reviewed; all 14 names matched to 12 existing
assets; TypeScript syntax checked. A full application build and database
backfill require the project dependencies and a database connection.

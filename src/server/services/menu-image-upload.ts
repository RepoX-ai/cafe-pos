import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local-filesystem storage for menu item photos uploaded through the admin
 * UI, served back out of the Next.js `public/` dir. Per AGENTS.md rule 10
 * (no Vercel-only / Supabase-Edge-only APIs), this must work identically
 * under `docker compose` and plain `next start` — no S3/blob-store
 * dependency, just a directory on disk that ships with the app container
 * (see Dockerfile, which chowns it to the `nextjs` user).
 */

const MENU_IMAGE_DIR = path.join(process.cwd(), "public", "uploads", "menu");
const MENU_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB

const MENU_IMAGE_EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type SaveMenuImageResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validates and persists an uploaded menu item photo, returning the
 * site-relative URL to store on `menuItems.imageUrl`.
 */
export async function saveMenuImage(file: File): Promise<SaveMenuImageResult> {
  const ext = MENU_IMAGE_EXT_BY_TYPE[file.type];
  if (!ext) {
    return { ok: false, error: "Image must be a JPG, PNG, or WebP file." };
  }
  if (file.size > MENU_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image must be 5MB or smaller." };
  }

  await mkdir(MENU_IMAGE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(MENU_IMAGE_DIR, filename), buffer);

  return { ok: true, url: `/uploads/menu/${filename}` };
}

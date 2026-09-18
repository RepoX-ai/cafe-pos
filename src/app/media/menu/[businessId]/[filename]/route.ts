import { readFile } from "node:fs/promises";
import path from "node:path";
import { menuImageDirectory } from "@/server/services/menu-image-upload";

const UUID = /^[a-f0-9-]{36}$/;
const IMAGE = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;

/**
 * Serves menu photos written since uploads became business-scoped. The
 * sibling `[filename]` route still serves the flat files saved before
 * that, so existing `menu_items.image_url` values keep resolving.
 *
 * Both segments are matched against fixed patterns before touching the
 * disk, so neither can walk out of the upload directory. The images
 * themselves are public — they are on a menu — so there is no session
 * check here; the business id is a path component, not an authorisation.
 */
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ businessId: string; filename: string }> },
) {
  const { businessId, filename } = await params;
  if (process.env.STORAGE_PROVIDER !== "local" || process.env.VERCEL) {
    return new Response(null, { status: 404 });
  }
  if (!UUID.test(businessId) || !IMAGE.test(filename)) {
    return new Response(null, { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(menuImageDirectory(), businessId, filename));
    const ext = filename.split(".").pop();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
    throw error;
  }
}

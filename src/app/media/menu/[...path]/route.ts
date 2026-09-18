import { readFile } from "node:fs/promises";
import path from "node:path";
import { menuImageDirectory } from "@/server/services/menu-image-upload";

const UUID = /^[a-f0-9-]{36}$/;
const IMAGE = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;

/**
 * Serves uploaded menu photos in both shapes this app has written:
 *
 *   /media/menu/<uuid>.jpg               flat, written before multi-tenancy
 *   /media/menu/<businessId>/<uuid>.jpg  business-scoped, written since
 *
 * One catch-all rather than two routes because Next.js rejects two
 * different slug names at the same position ([filename] vs [businessId]),
 * and the legacy URLs are still in `menu_items.image_url`.
 *
 * Every segment is matched against a fixed pattern before touching the
 * disk, so no request can walk out of the upload directory. The images
 * themselves are public — they are on a menu — so there is no session
 * check here; the business id is a path component, not an authorisation.
 */
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  if (process.env.STORAGE_PROVIDER !== "local" || process.env.VERCEL) {
    return new Response(null, { status: 404 });
  }

  let relative: string;
  if (segments.length === 1 && IMAGE.test(segments[0])) {
    relative = segments[0];
  } else if (segments.length === 2 && UUID.test(segments[0]) && IMAGE.test(segments[1])) {
    relative = path.join(segments[0], segments[1]);
  } else {
    return new Response(null, { status: 404 });
  }

  try {
    const bytes = await readFile(path.join(menuImageDirectory(), relative));
    const ext = relative.split(".").pop();
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

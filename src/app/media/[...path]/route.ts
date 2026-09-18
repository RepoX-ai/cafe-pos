import { readFile } from "node:fs/promises";
import path from "node:path";
import { menuImageDirectory, uploadDirectory, type ImageFolder } from "@/server/services/menu-image-upload";

const UUID = /^[a-f0-9-]{36}$/;
const IMAGE = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;
const FOLDERS: ImageFolder[] = ["menu", "brand"];

/**
 * Serves uploaded images in the three shapes this app has written:
 *
 *   /media/menu/<uuid>.jpg                flat, before multi-tenancy
 *   /media/menu/<businessId>/<uuid>.jpg   menu photos since
 *   /media/brand/<businessId>/<uuid>.png  business logos
 *
 * One catch-all rather than a route per folder because Next.js rejects two
 * different slug names at the same position, and the flat legacy URLs are
 * still in `menu_items.image_url`.
 *
 * Every segment is matched against a fixed pattern before touching the
 * disk, so no request can walk out of the upload directory. The images are
 * public — menu photos and a logo both appear on a receipt or a menu — so
 * there is no session check; the business id is a path component, not an
 * authorisation.
 */
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  if (process.env.STORAGE_PROVIDER !== "local" || process.env.VERCEL) {
    return new Response(null, { status: 404 });
  }

  const [folder, ...rest] = segments;
  if (!FOLDERS.includes(folder as ImageFolder)) return new Response(null, { status: 404 });

  let file: string;
  if (folder === "menu" && rest.length === 1 && IMAGE.test(rest[0])) {
    file = path.join(menuImageDirectory(), rest[0]); // legacy flat path
  } else if (rest.length === 2 && UUID.test(rest[0]) && IMAGE.test(rest[1])) {
    file = path.join(uploadDirectory(folder as ImageFolder), rest[0], rest[1]);
  } else {
    return new Response(null, { status: 404 });
  }

  try {
    const bytes = await readFile(file);
    const ext = file.split(".").pop();
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

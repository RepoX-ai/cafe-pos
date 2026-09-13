import { readFile } from "node:fs/promises";
import path from "node:path";
import { menuImageDirectory } from "@/server/services/menu-image-upload";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (process.env.STORAGE_PROVIDER !== "local" || process.env.VERCEL || !/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(filename)) {
    return new Response(null, { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(menuImageDirectory(), filename));
    const ext = filename.split(".").pop();
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`,
      "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
    throw error;
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const MENU_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

/** Folders under the upload root. Both are business-scoped; see saveImage. */
export type ImageFolder = "menu" | "brand";
/**
 * Root of the local upload tree. Named for the env var that has always
 * configured it, which points at the `menu` folder's parent in practice —
 * `uploadDirectory("menu")` therefore resolves exactly where menu photos
 * already live, and brand logos sit beside them.
 */
export function menuImageDirectory() {
  return process.env.MENU_IMAGE_DIR || path.join(process.cwd(), "var", "uploads", "menu");
}

/** `<root>/<folder>` for everything except menu, which *is* the root. */
export function uploadDirectory(folder: ImageFolder) {
  return folder === "menu" ? menuImageDirectory() : path.join(menuImageDirectory(), folder);
}
export type SaveMenuImageResult = { ok: true; url: string } | { ok: false; error: string };

export function imageExtension(buffer: Buffer, mime: string): string | null {
  if (mime === "image/jpeg" && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpg";
  if (mime === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (mime === "image/webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Explicit local durable disk or portable S3-compatible object storage.
 *
 * Files are filed under the owning business. Nothing is guessable either
 * way — the name is a UUID — but without the prefix there is no way to
 * export, count or delete one business's images when it leaves, and no way
 * to put a quota on one café's uploads. Images saved before this existed
 * keep their flat path and their URLs keep working; see the two routes
 * under src/app/media/menu.
 */
export async function saveMenuImage(file: File, businessId: string): Promise<SaveMenuImageResult> {
  return saveImage(file, businessId, "menu");
}

/** The business's own logo, shown in the app shell and the POS header. */
export async function saveBusinessLogo(file: File, businessId: string): Promise<SaveMenuImageResult> {
  return saveImage(file, businessId, "brand");
}

async function saveImage(file: File, businessId: string, folder: ImageFolder): Promise<SaveMenuImageResult> {
  if (file.size === 0 || file.size > MENU_IMAGE_MAX_BYTES) return { ok: false, error: "Image must be between 1 byte and 3MB." };
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = imageExtension(buffer, file.type);
  if (!ext) return { ok: false, error: "Image contents must match JPG, PNG, or WebP format." };
  const filename = `${randomUUID()}.${ext}`;
  const provider = process.env.STORAGE_PROVIDER;
  if (provider === "local" && !process.env.VERCEL) {
    const directory = path.join(uploadDirectory(folder), businessId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), buffer, { flag: "wx" });
    return { ok: true, url: `/media/${folder}/${businessId}/${filename}` };
  }
  if (provider !== "s3") return { ok: false, error: "Photo uploads need storage configuration. You can paste an image URL instead." };
  const { STORAGE_BUCKET: bucket, STORAGE_ACCESS_KEY: accessKeyId, STORAGE_SECRET_KEY: secretAccessKey, STORAGE_PUBLIC_URL: publicUrl } = process.env;
  if (!bucket || !accessKeyId || !secretAccessKey || !publicUrl) return { ok: false, error: "Photo storage configuration is incomplete." };
  const base = new URL(publicUrl);
  if (!["https:", "http:"].includes(base.protocol)) return { ok: false, error: "Photo storage URL must use HTTP or HTTPS." };
  const client = new S3Client({ endpoint: process.env.STORAGE_ENDPOINT || undefined,
    region: process.env.STORAGE_REGION || "auto", forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId, secretAccessKey } });
  const key = `${folder}/${businessId}/${filename}`;
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: file.type,
      CacheControl: "public, max-age=31536000, immutable" }));
  } catch { return { ok: false, error: "Could not save the photo. Check storage configuration and try again." }; }
  finally { client.destroy(); }
  return { ok: true, url: `${publicUrl.replace(/\/$/, "")}/${key}` };
}

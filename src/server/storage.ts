// File storage for menu images and logos. V1: local disk (./storage/uploads),
// served by src/app/uploads/[...path]/route.ts. Swap `saveImage`/`readImage` for
// S3/R2/GCS in production — the public URL shape (/uploads/...) stays the same.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors";
import { randomToken } from "./tokens";

// Runtime data directory, not source: keep it out of output file tracing.
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "storage/uploads");
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type ImageType = { ext: "jpg" | "png" | "webp"; mime: string };

/** Identifies the image by its magic bytes — never by file name or client MIME type. SVG is rejected. */
export function sniffImage(buf: Uint8Array): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b))
    return { ext: "png", mime: "image/png" };
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.slice(8, 12)) === "WEBP"
  )
    return { ext: "webp", mime: "image/webp" };
  return null;
}

export async function saveImage(tenantId: string, data: Uint8Array): Promise<string> {
  if (data.byteLength === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (data.byteLength > MAX_IMAGE_BYTES) throw new AppError("VALIDATION", "Images must be 2 MB or smaller.");
  const type = sniffImage(data);
  if (!type) throw new AppError("VALIDATION", "Upload a JPEG, PNG or WebP image.");
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) throw new AppError("VALIDATION", "Invalid tenant.");
  const dir = path.join(ROOT, tenantId);
  await mkdir(dir, { recursive: true });
  const name = `${randomToken(12)}.${type.ext}`;
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, name), data);
  return `/uploads/${tenantId}/${name}`;
}

export async function readImage(segments: string[]): Promise<{ data: Buffer; mime: string } | null> {
  if (segments.length !== 2) return null;
  const [tenantId, file] = segments;
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId) || !/^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(file)) return null;
  const full = path.join(ROOT, tenantId, file);
  if (!full.startsWith(ROOT + path.sep)) return null;
  try {
    const data = await readFile(full);
    const type = sniffImage(data);
    return type ? { data, mime: type.mime } : null;
  } catch {
    return null;
  }
}

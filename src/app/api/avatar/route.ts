import { NextResponse } from "next/server";
import { logEvent } from "@/lib/events";
import { guard } from "@/lib/guard";
import sharp from "sharp";
import { mediaUrl, saveMedia } from "@/lib/media";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/**
 * Avatar fotoğrafını JPEG'e çevirip kendi diskimize kaydeder ve /api/media
 * adresini döner. Fotoğraf bir kez yükleniyor, sonraki her kombin aynı
 * adresten üretiliyor.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let device = request.headers.get("x-tryit-device") ?? "";

  const note = (ok: boolean, code?: string, detail?: string) =>
    logEvent({
      at: new Date().toISOString(),
      event: "avatar",
      device,
      ok,
      code,
      ms: Date.now() - started,
      detail,
    });

  const verdict = guard(request, "avatar");
  if (!verdict.ok) {
    await note(false, verdict.code);
    return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: verdict.status });
  }
  device = verdict.device;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    await note(false, "bad-body");
    return NextResponse.json({ error: "Dosya okunamadı.", code: "bad-file" }, { status: 400 });
  }

  if (!file) {
    await note(false, "no-file");
    return NextResponse.json({ error: "Bir fotoğraf seçin.", code: "no-file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    await note(false, "too-big", `${Math.round(file.size / 1024)}KB`);
    return NextResponse.json({ error: "Fotoğraf 12 MB'tan küçük olmalı.", code: "too-large" }, { status: 413 });
  }
  if (file.type && !ALLOWED.has(file.type.toLowerCase())) {
    await note(false, "bad-type", file.type.slice(0, 60));
    return NextResponse.json({ error: "Yalnızca JPEG, PNG veya WebP yükleyin.", code: "bad-type" }, { status: 415 });
  }

  let jpeg: Buffer;
  try {
    jpeg = await toJpeg(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    // sharp açamıyorsa içerik beyan edilen türde değil.
    await note(false, "bad-type", String(err instanceof Error ? err.message : err).slice(0, 200));
    return NextResponse.json({ error: "Yalnızca JPEG, PNG veya WebP yükleyin.", code: "bad-type" }, { status: 415 });
  }

  try {
    const name = await saveMedia(jpeg, "jpg");
    await note(true, undefined, `${Math.round(file.size / 1024)}KB`);
    return NextResponse.json({ url: mediaUrl(request, name) });
  } catch (err) {
    await note(false, "upload-failed", String(err instanceof Error ? err.message : err).slice(0, 200));
    console.error("avatar upload failed", err);
    return NextResponse.json({ error: "Fotoğraf yüklenemedi.", code: "upload-failed" }, { status: 502 });
  }
}

const DECODABLE = new Set(["jpeg", "png", "webp", "heif"]);

/** Biçimi içerikten doğrular, EXIF yönünü uygular, uzun kenarı 2048'e indirir; açılmayan dosya hata fırlatır. */
async function toJpeg(buffer: Buffer): Promise<Buffer> {
  // Sıkıştırılmış küçük dosya devasa piksel sayısına açılıp belleği tüketmesin.
  const image = sharp(buffer, { limitInputPixels: 25_000_000, sequentialRead: true });
  const { format } = await image.metadata();
  if (!format || !DECODABLE.has(format)) throw new Error(`Desteklenmeyen biçim: ${format ?? "bilinmiyor"}`);
  return image
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

import { readFile, stat } from "node:fs/promises";
import { MAX_MEDIA_BYTES, mediaPath, parseMediaName } from "@/lib/media";

export const runtime = "nodejs";

function notFound(): Response {
  return new Response("Bulunamadı.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Kayıtlı görseli sunar. Kimlik doğrulama yok: ad 128 bit rastgele olduğu
 * için adresi bilmek görseli görme yetkisi sayılıyor.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const parsed = parseMediaName(name);
  const path = mediaPath(name);
  if (!parsed || !path) return notFound();

  let data: Buffer;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_MEDIA_BYTES) return notFound();
    data = await readFile(path);
  } catch {
    return notFound();
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": parsed.contentType,
      "content-length": String(data.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${name}"`,
    },
  });
}

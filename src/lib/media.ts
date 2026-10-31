import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Avatar ve kombin görselleri kendi diskimizde duruyor ve /api/media/<ad>
 * üzerinden sunuluyor. Ad 128 bit rastgele; tahmin edilemeyen adres
 * yetkilendirmenin yerine geçiyor.
 */

export type MediaExt = "jpg" | "png" | "webp";

export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
export const MEDIA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TMP_TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const MEDIA_ROUTE = "/api/media/";

const CONTENT_TYPES: Record<MediaExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const NAME_PATTERN = /^([a-f0-9]{32})\.(jpg|png|webp)$/;

// Dizin her çağrıda okunuyor ki testler TRYIT_DATA_DIR'ı sonradan ayarlayabilsin.
export function mediaDir(): string {
  return join(process.env.TRYIT_DATA_DIR || ".data", "media");
}

export function parseMediaName(name: string): { id: string; ext: MediaExt; contentType: string } | null {
  const match = NAME_PATTERN.exec(name);
  if (!match) return null;
  const ext = match[2] as MediaExt;
  return { id: match[1], ext, contentType: CONTENT_TYPES[ext] };
}

export function mediaPath(name: string): string | null {
  if (!parseMediaName(name)) return null;
  const dir = resolve(mediaDir());
  const full = resolve(join(dir, name));
  return full.startsWith(dir + sep) ? full : null;
}

export async function saveMedia(buffer: Buffer, ext: MediaExt): Promise<string> {
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`Görsel çok büyük (${buffer.byteLength} bayt).`);
  }
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  const full = mediaPath(name);
  if (!full) throw new Error("Geçersiz medya adı.");
  await mkdir(mediaDir(), { recursive: true });
  // Önce geçici dosyaya yazılıyor ki yarım dosya hiç sunulmasın.
  const tmp = `${full}.tmp`;
  await writeFile(tmp, buffer);
  await rename(tmp, full);
  return name;
}

type HeaderSource = { headers: Headers };

export function publicBaseUrl(request: HeaderSource): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedHost = firstValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || request.headers.get("host");
  if (!host) return "http://localhost:3000";
  const forwardedProto = firstValue(request.headers.get("x-forwarded-proto"));
  const proto = forwardedProto === "http" ? "http" : "https";
  // Host yalnız ad, iki nokta ve port karakterlerinden oluşabilir; başka şey gelirse türetme yapılmaz.
  if (!/^[A-Za-z0-9.\-\[\]:]{1,255}$/.test(host)) return "http://localhost:3000";
  return `${proto}://${host}`;
}

function firstValue(raw: string | null): string {
  return (raw ?? "").split(",")[0].trim();
}

export function mediaUrl(request: HeaderSource, name: string): string {
  return `${publicBaseUrl(request)}${MEDIA_ROUTE}${name}`;
}

/** Adres bizim medya yolumuzu gösteriyorsa ve dosya diskteyse yolunu döner. */
export async function localMediaPath(url: string): Promise<string | null> {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(MEDIA_ROUTE)) return null;
  const full = mediaPath(pathname.slice(MEDIA_ROUTE.length));
  if (!full) return null;
  try {
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

export function isExpired(mtimeMs: number, nowMs: number, ttlMs: number): boolean {
  return nowMs - mtimeMs > ttlMs;
}

let sweeping: Promise<{ removed: number }> | null = null;

export function sweepMedia(now = Date.now()): Promise<{ removed: number }> {
  if (!sweeping) {
    sweeping = runSweep(now).finally(() => {
      sweeping = null;
    });
  }
  return sweeping;
}

async function runSweep(now: number): Promise<{ removed: number }> {
  let names: string[];
  try {
    names = await readdir(mediaDir());
  } catch (err) {
    if (isNotFound(err)) return { removed: 0 };
    throw err;
  }
  let removed = 0;
  for (const name of names) {
    const ttl = sweepTtl(name);
    if (ttl === null) continue;
    if (await removeIfExpired(join(mediaDir(), name), now, ttl)) removed += 1;
  }
  return { removed };
}

/** Yalnız bizim adlarımıza ve geçici dosyalara dokunuluyor; yabancı dosya kalır. */
function sweepTtl(name: string): number | null {
  if (parseMediaName(name)) return MEDIA_TTL_MS;
  if (name.endsWith(".tmp")) return TMP_TTL_MS;
  return null;
}

async function removeIfExpired(path: string, now: number, ttl: number): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile() || !isExpired(info.mtimeMs, now, ttl)) return false;
    await unlink(path);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

let scheduled = false;

export function scheduleMediaSweep(): void {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    sweepMedia().catch((err) => console.error("media sweep failed", err));
  };
  run();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}

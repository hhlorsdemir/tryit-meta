/**
 * Web portalının kimliği.
 *
 * Tarayıcıya uygulama anahtarı verilemez; verilse herkes okur. Onun yerine
 * sunucunun imzaladığı rastgele bir kimlik HttpOnly çerezde duruyor. Çerezi
 * silen yeni kimlik alır, bu yüzden guard ayrıca IP başına sınır koyuyor.
 *
 * Buradaki fonksiyonlar saf; ağ ve disk yok, testte doğrudan deneniyor.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIPv6 } from "node:net";

export const WEB_COOKIE = "tryit_web";

/** Kimlik ön eki. Guard'ın cihaz kalıbına uyuyor ve günlükte web'i ayırıyor. */
export const WEB_PREFIX = "web-";

const ID_PATTERN = /^[0-9a-f]{32}$/;

let warned = false;

/** Web kanalının sırrı. Bayrak açık ama sır yoksa kanal kapalı sayılır. */
export function webSecret(): string | undefined {
  if (process.env.TRYIT_WEB_ENABLED !== "1") return undefined;
  const secret = process.env.TRYIT_WEB_SECRET;
  if (!secret && !warned) {
    warned = true;
    console.warn("TRYIT_WEB_ENABLED=1 ama TRYIT_WEB_SECRET tanımsız; web kanalı kapalı.");
  }
  return secret || undefined;
}

export function newWebId(): string {
  return randomBytes(16).toString("hex");
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

/** Çerez değeri: `id.sig`. */
export function signWebId(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

/** Çerez geçerliyse `web-<id>` döner, değilse undefined. */
export function parseWebCookie(value: string | undefined, secret: string): string | undefined {
  if (!value) return undefined;
  const dot = value.indexOf(".");
  if (dot < 0) return undefined;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!ID_PATTERN.test(id)) return undefined;

  const expected = Buffer.from(sign(id, secret));
  const sent = Buffer.from(sig);
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return undefined;
  return `${WEB_PREFIX}${id}`;
}

/** Cookie başlığından tek bir çerezi okur. */
export function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * İsteğin IP adresi. Önde Caddy var ve bu başlıkları kendisi yazıyor;
 * sunucu doğrudan internete açılırsa başlıklar sahte olabilir.
 *
 * IPv6'da tek kullanıcı genelde koca bir /64 alır; adres değiştirip sınırı
 * aşmasın diye /64 önekine indiriliyor.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || headers.get("x-real-ip")?.trim();
  return raw ? ipBucket(raw) : "unknown";
}

function ipBucket(ip: string): string {
  if (!isIPv6(ip)) return ip;
  // IPv4 eşlemeli adres (::ffff:1.2.3.4) aslında tek bir IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // "::" kısaltmasını açıp ilk 4 grubu alıyoruz; IPv4 gömülü kuyruk ilk 4'e girmez.
  const groups = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * İstek aynı siteden mi geliyor. Çerez başka sitenin formuyla da gider;
 * bunu kesmek için Sec-Fetch-Site ve Origin bakılıyor. İkisi de yoksa
 * reddediliyor: güncel tarayıcılar Sec-Fetch-Site gönderiyor, göndermeyen
 * genelde betiktir (curl ile çerez alıp API çağırma kapanıyor).
 */
export function sameOrigin(request: { headers: Headers }): boolean {
  const headers = request.headers;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = headers.get("origin");
  if (!origin) return Boolean(site);
  const host = (headers.get("x-forwarded-host")?.split(",")[0] ?? headers.get("host") ?? "").trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Secure bayrağı: https üzerinden gelen isteklerde. Yerelde http kalıyor. */
export function isHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return new URL(request.url).protocol === "https:";
}

/**
 * API'yi kötüye kullanıma karşı koruyan katman.
 *
 * Her giydirme parayla üretiliyor ve uçlar internete açık. Üç kat var:
 * uygulama anahtarı (sıradan meraklıyı keser), cihaz başına sınır (tek
 * kullanıcının çarçur etmesini keser) ve sunucu geneli günlük tavan
 * (anahtar sızsa bile faturayı sınırlar).
 *
 * Sayaçlar bellekte tutuluyor ama açılışta olay günlüğünden geri
 * dolduruluyor. Yoksa konteyneri yeniden başlatmak herkesin kotasını
 * sıfırlardı ve sınır kağıt üstünde kalırdı.
 *
 * Web portalı anahtarsız geliyor: kimliği imzalı çerez (webid.ts), sınırları
 * ayrı ve daha sıkı, üstüne IP başına ve web geneli tavan var.
 */

import { recentForCounters } from "./events";
import { WEB_COOKIE, WEB_PREFIX, clientIp, parseWebCookie, readCookie, sameOrigin, webSecret } from "./webid";

export type Channel = "app" | "web";

export type GuardVerdict =
  | { ok: true; device: string; channel: Channel }
  | { ok: false; status: number; message: string; code: GuardCode };

type Rejection = Extract<GuardVerdict, { ok: false }>;

/** Kapıda dönmenin nedenleri. events.ts bu kodları kota dışı sayıyor. */
export type GuardCode =
  | "no-key"
  | "no-device"
  | "rate-hour"
  | "rate-day"
  | "global-day"
  | "bad-origin"
  | "no-session"
  | "web-forbidden";

export type Bucket = "resolve" | "avatar" | "tryon" | "credits" | "attest";

type Limit = { perHour: number; perDay?: number };

/** Cihaz başına sınırlar. Ortam değişkeniyle değiştirilebiliyor. */
const LIMITS: Record<Bucket, Limit> = {
  resolve: { perHour: num("TRYIT_LIMIT_RESOLVE_HOUR", 60) },
  avatar: { perHour: num("TRYIT_LIMIT_AVATAR_HOUR", 10) },
  // Jüri modunda (TRYIT_UNLIMITED=1) varsayılanlar yükseliyor ama tavan kalkmıyor.
  tryon: {
    perHour: num("TRYIT_LIMIT_TRYON_HOUR", juryDefault(12, 30)),
    perDay: num("TRYIT_LIMIT_TRYON_DAY", juryDefault(40, 150)),
  },
  // Kalan hak sorgusu ucuz ama Apple imzası doğrulanıyor; sınırsız kalmasın.
  credits: { perHour: num("TRYIT_LIMIT_CREDITS_HOUR", 120) },
  // Cihaz doğrulaması normalde kurulumda bir kez; soru ve cevap iki istek.
  attest: { perHour: num("TRYIT_LIMIT_ATTEST_HOUR", 20) },
};

/** Sunucu geneli günlük giydirme tavanı. */
const GLOBAL_TRYON_DAY = num("TRYIT_LIMIT_TRYON_GLOBAL_DAY", juryDefault(300, 1000));

/** Web'de açık kovalar. Kredi ve App Attest yalnız uygulamanın işi. */
type WebBucket = "resolve" | "avatar" | "tryon";

function webLimit(bucket: string, hour: number, day?: number): { id: Limit; ip: Limit } {
  const upper = bucket.toUpperCase();
  const optionalDay = (key: string, fallback?: number) =>
    fallback === undefined ? undefined : num(key, fallback);
  return {
    id: {
      perHour: num(`TRYIT_WEB_LIMIT_${upper}_HOUR`, hour),
      perDay: optionalDay(`TRYIT_WEB_LIMIT_${upper}_DAY`, day),
    },
    // Çerezi silen yeni kimlik alıyor; IP sınırı bunu kesiyor.
    ip: {
      perHour: num(`TRYIT_WEB_IP_LIMIT_${upper}_HOUR`, hour * 2),
      perDay: optionalDay(`TRYIT_WEB_IP_LIMIT_${upper}_DAY`, day === undefined ? undefined : day * 2),
    },
  };
}

/** Web kimliği ve IP başına sınırlar. */
const WEB_LIMITS: Record<WebBucket, { id: Limit; ip: Limit }> = {
  resolve: webLimit("resolve", 30),
  avatar: webLimit("avatar", 6, 20),
  tryon: webLimit("tryon", 6, 20),
};

/** Web geneli günlük giydirme tavanı. Kombin yaklaşık 0,02 $; en kötü gün 4 $. */
const WEB_GLOBAL_TRYON_DAY = num("TRYIT_WEB_LIMIT_TRYON_GLOBAL_DAY", 200);

/** Oturum açma (çerez üretme) IP başına. */
const WEB_SESSION_IP_HOUR = 30;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function num(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Açık ortam değişkeni yoksa kullanılacak varsayılan; jüri modunda daha cömert. */
function juryDefault(normal: number, jury: number): number {
  return process.env.TRYIT_UNLIMITED === "1" ? jury : normal;
}

/**
 * Zaman damgası listeleri. Geliştirme sunucusu modülleri yeniden yüklediği
 * için globalThis üzerinde duruyor, yoksa her değişiklikte sayaçlar sıfırlanır.
 */
const store = globalThis as typeof globalThis & {
  __tryitHits?: Map<string, number[]>;
  __tryitPrunedAt?: number;
  __tryitSeeded?: boolean;
};

function hits(): Map<string, number[]> {
  store.__tryitHits ??= new Map();
  return store.__tryitHits;
}

/**
 * Sayaçları günlükten geri doldurur. Bir kez çalışıyor.
 *
 * Günlük satırı istek bittiğinde yazılıyor, sayaç ise başında
 * artıyor. Aradaki fark yalnızca çökmüş isteklerde oluşur; o da
 * kullanıcı lehine, sayaç bir eksik başlar.
 */
function seed(now: number): void {
  if (store.__tryitSeeded) return;
  store.__tryitSeeded = true;

  for (const event of recentForCounters(now)) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    push(`${event.event}:${event.device}`, at);
    if (event.event === "tryon") push("global:tryon", at);
    if (event.event === "tryon" && event.device?.startsWith(WEB_PREFIX)) push("webglobal:tryon", at);
  }
}

function push(key: string, at: number): void {
  const stamps = hits().get(key) ?? [];
  stamps.push(at);
  hits().set(key, stamps);
}

/** Bir günden eski kayıtları atar; bırakılırsa terk edilmiş cihazlar birikir. */
function prune(now: number): void {
  if (now - (store.__tryitPrunedAt ?? 0) < HOUR) return;
  store.__tryitPrunedAt = now;

  for (const [key, stamps] of hits()) {
    const fresh = stamps.filter((at) => now - at < DAY);
    if (fresh.length) hits().set(key, fresh);
    else hits().delete(key);
  }
}

function countWithin(key: string, window: number, now: number): number {
  const stamps = hits().get(key);
  if (!stamps) return 0;
  return stamps.filter((at) => now - at < window).length;
}

function record(key: string, now: number): void {
  const stamps = hits().get(key) ?? [];
  stamps.push(now);
  // Bir günlük pencereden uzun tutmanın anlamı yok.
  hits().set(
    key,
    stamps.filter((at) => now - at < DAY),
  );
}

/**
 * İsteği denetler. Geçerse kimliği ve kanalı döner, kotayı işler.
 *
 * `TRYIT_APP_KEY` tanımlı değilse anahtar aranmıyor: geliştirme sırasında
 * kimse kendi makinesinde anahtar kurmak zorunda kalmasın diye. Anahtar
 * başlığı hiç yoksa istek web portalından sayılıyor; anahtar tanımsızken
 * (yerel geliştirme) bu yalnız web kanalı açıksa geçerli, yoksa eski yol.
 */
export function guard(request: Request, bucket: Bucket): GuardVerdict {
  const expected = process.env.TRYIT_APP_KEY;
  const sent = request.headers.get("x-tryit-key");
  if (!sent && (expected || process.env.TRYIT_WEB_ENABLED === "1")) return webGuard(request, bucket);

  if (expected && (!sent || !timingSafeEqual(sent, expected))) {
    return reject(401, "Bu istek yetkili değil.", "no-key");
  }

  const device = (request.headers.get("x-tryit-device") ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(device)) {
    return reject(400, "Cihaz kimliği eksik.", "no-device");
  }

  const now = Date.now();
  seed(now);
  prune(now);

  const key = `${bucket}:${device}`;
  const blocked =
    overLimit(key, LIMITS[bucket], now) ??
    (bucket === "tryon" ? overGlobal("global:tryon", GLOBAL_TRYON_DAY, now) : undefined);
  if (blocked) return blocked;

  record(key, now);
  if (bucket === "tryon") record("global:tryon", now);

  return { ok: true, device, channel: "app" };
}

/** Anahtarsız istek: web portalı. Kanal kapalıysa eskisi gibi no-key. */
function webGuard(request: Request, bucket: Bucket): GuardVerdict {
  const secret = webSecret();
  if (!secret) return reject(401, "Bu istek yetkili değil.", "no-key");
  if (!sameOrigin(request)) return reject(403, "Bu istek yetkili değil.", "bad-origin");

  const device = parseWebCookie(readCookie(request.headers, WEB_COOKIE), secret);
  if (!device) return reject(401, "Oturum bulunamadı. Sayfayı yenile.", "no-session");
  if (bucket === "credits" || bucket === "attest") {
    return reject(403, "Bu işlem web'de yok.", "web-forbidden");
  }

  const now = Date.now();
  seed(now);
  prune(now);

  // IP sayaçları günlükte yok, yeniden başlatmada sıfırlanıyor. Kimlik ve
  // web geneli sayaçlar geri dolduğu için bu kabul edilen bir taviz.
  const limits = WEB_LIMITS[bucket];
  const key = `${bucket}:${device}`;
  const ipKey = `webip:${bucket}:${clientIp(request.headers)}`;
  const blocked =
    overLimit(key, limits.id, now) ??
    overLimit(ipKey, limits.ip, now) ??
    (bucket === "tryon"
      ? (overGlobal("webglobal:tryon", WEB_GLOBAL_TRYON_DAY, now) ??
        overGlobal("global:tryon", GLOBAL_TRYON_DAY, now))
      : undefined);
  if (blocked) return blocked;

  record(key, now);
  record(ipKey, now);
  if (bucket === "tryon") {
    record("webglobal:tryon", now);
    // Bilinçli: sunucu geneli tavan kanal fark etmeksizin faturayı sınırlıyor.
    record("global:tryon", now);
  }

  return { ok: true, device, channel: "web" };
}

/**
 * Web oturumu (çerez) üretmeye izin var mı; varsa sayar. Çerezi silip
 * yeni kimlik almak sınırsız olmasın diye IP başına.
 */
export function allowWebSession(ip: string): boolean {
  const now = Date.now();
  prune(now);
  const key = `webip:session:${ip}`;
  if (countWithin(key, HOUR, now) >= WEB_SESSION_IP_HOUR) return false;
  record(key, now);
  return true;
}

function reject(status: number, message: string, code: GuardCode): Rejection {
  return { ok: false, status, message, code };
}

function overLimit(key: string, limit: Limit, now: number): Rejection | undefined {
  if (countWithin(key, HOUR, now) >= limit.perHour) {
    return reject(429, "Çok fazla deneme yaptın. Bir saat sonra tekrar dene.", "rate-hour");
  }
  if (limit.perDay && countWithin(key, DAY, now) >= limit.perDay) {
    return reject(429, "Günlük deneme hakkın doldu. Yarın devam edebilirsin.", "rate-day");
  }
  return undefined;
}

function overGlobal(key: string, cap: number, now: number): Rejection | undefined {
  if (countWithin(key, DAY, now) < cap) return undefined;
  return reject(503, "Bugünlük kapasite doldu. Yarın tekrar dene.", "global-day");
}

/** Uzunluk farkını da gizleyen sabit zamanlı karşılaştırma. */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

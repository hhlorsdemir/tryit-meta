/**
 * Olay günlüğü.
 *
 * Her istek bittiğinde tek satır JSON yazılıyor. Amacı üç tane:
 * hangi adımda kaç kişi düşüyor görmek, başarısız üretimlerin nedenini
 * saymak, ve konteyner yeniden başladığında kotaları kaybetmemek.
 *
 * Veritabanı yok. Bu ölçekte günde birkaç bin satır oluyor, dosya
 * yeterli; kurulacak, yedeklenecek, güncellenecek bir şey çıkmıyor.
 * Para işine girdiğimiz gün kredi düşmek atomik olmak zorunda, orada
 * SQLite'a geçeceğiz.
 *
 * İçinde kişisel veri yok: cihaz kimliği rastgele bir UUID, ürün
 * adresinin yalnızca alan adı tutuluyor, tam link tutulmuyor.
 */

import { appendFile, readdir, readFile, rm } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type EventName = "resolve" | "avatar" | "tryon" | "attest" | "appstore";

export type TryItEvent = {
  /** ISO zaman damgası. */
  at: string;
  event: EventName;
  /** Cihaz kimliği. Kota ve sınıflandırma bunun üzerinden. */
  device: string;
  ok: boolean;
  /** Başarısızlığın nedeni. Sabit bir listeden geliyor ki sayılabilsin. */
  code?: string;
  /** İsteğin sürdüğü süre, milisaniye. */
  ms: number;
  /** Yalnızca resolve için: ürün sitesinin alan adı. */
  host?: string;
  /** Kısa serbest metin. Yalnızca teşhis için, gruplama buna bakmıyor. */
  detail?: string;
  // Yalnız tryon için: H-009 ölçümü.
  /** Giydirmeyi yapan motor. */
  provider?: "muse";
  /** Tahmini çağrı maliyeti, USD. */
  costUsd?: number;
  museMs?: number;
  // H-005 ürün kartı (Muse Spark). resolve: kartın durumu ve maliyeti;
  // tryon: kaç parçada tarif bulundu.
  /** resolve: ok (cevapta), pending (arka planda sürüyor), disabled, error, not-garment. */
  cardCode?: string;
  cardMs?: number;
  cardCostUsd?: number;
  /** tryon: tarifi olan parça sayısı. */
  cards?: number;
  // H-015c resolve: ürünü hangi okuyucu buldu ve Spark yedeğinin bedeli.
  /** resolve: jsonld, opengraph, amazon veya spark. */
  resolveSource?: string;
  /** resolve: Spark yedeğinin süresi (indirme dahil), milisaniye. */
  sparkMs?: number;
  /** resolve: Spark yedeğinin tahmini maliyeti, USD. */
  sparkCostUsd?: number;
};

/** Kotayı tüketmeyen, kapıda dönen istekler. Sayaç bunları saymıyor. */
const GUARD_CODES = new Set([
  "no-key",
  "no-device",
  "rate-hour",
  "rate-day",
  "global-day",
  "bad-origin",
  "no-session",
  "web-forbidden",
]);

const DAY = 24 * 60 * 60 * 1000;

/** Kaç günlük dosya tutuluyor. Eskiyenler siliniyor. */
const KEEP_DAYS = 60;

export function dataDir(): string {
  return process.env.TRYIT_DATA_DIR || ".data";
}

function fileFor(date: Date): string {
  return join(dataDir(), `events-${date.toISOString().slice(0, 10)}.jsonl`);
}

const store = globalThis as typeof globalThis & { __tryitSweptAt?: number };

/**
 * Bir olayı yazar. Hiçbir koşulda isteği düşürmüyor: günlük tutamamak
 * kullanıcının işini engellememeli, o yüzden hatalar yutuluyor.
 */
export async function logEvent(event: TryItEvent): Promise<void> {
  try {
    await appendFile(fileFor(new Date()), `${JSON.stringify(event)}\n`, "utf8");
    await sweep();
  } catch {
    // Dizin yoksa veya disk doluysa sessizce vazgeçiyoruz.
  }
}

/** Eski dosyaları atar. Günde bir kez bakıyor. */
async function sweep(): Promise<void> {
  const now = Date.now();
  if (now - (store.__tryitSweptAt ?? 0) < DAY) return;
  store.__tryitSweptAt = now;

  try {
    const oldest = new Date(now - KEEP_DAYS * DAY).toISOString().slice(0, 10);
    for (const name of await readdir(dataDir())) {
      const match = name.match(/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (match && match[1] < oldest) await rm(join(dataDir(), name), { force: true });
    }
  } catch {
    // Önemli değil, ertesi gün tekrar denenecek.
  }
}

/**
 * Son 24 saatin kota tüketen olaylarını okur.
 *
 * Yalnızca açılışta bir kez çağrılıyor, sayaçları kaldığı yerden
 * sürdürmek için. Senkron okuyor: iki küçük dosya ve ilk istekten
 * önce bitmesi gerekiyor.
 */
export function recentForCounters(now: number): TryItEvent[] {
  const days = [new Date(now), new Date(now - DAY)];
  const out: TryItEvent[] = [];

  for (const day of days) {
    let raw: string;
    try {
      raw = readFileSync(fileFor(day), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line) as TryItEvent;
        if (event.code && GUARD_CODES.has(event.code)) continue;
        if (now - Date.parse(event.at) < DAY) out.push(event);
      } catch {
        // Yarım yazılmış satır. Atla.
      }
    }
  }

  return out;
}

/** Günlük dosyalarının adlarını verir. Rapor betiği kullanıyor. */
export function listDays(): string[] {
  try {
    return readdirSync(dataDir())
      .filter((name) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

/** Bir günün olaylarını okur. */
export async function readDay(name: string): Promise<TryItEvent[]> {
  const raw = await readFile(join(dataDir(), name), "utf8");
  const out: TryItEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as TryItEvent);
    } catch {
      // Atla.
    }
  }
  return out;
}

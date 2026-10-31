/**
 * Ürün kartlarının kalıcı önbelleği: `<veri dizini>/product-cards.json`.
 * Bellekte tek kopya tutulur, dosya bir kez okunur; yazmalar sıraya alınır ve
 * tmp + rename ile atomik yapılır. Hatalar yutulur: önbellek isteği düşürmemeli.
 *
 * Yalnız node yerleşik modüllerini ve tip import'unu kullanır ki
 * `node --experimental-strip-types` testinde yüklenebilsin.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProductCard } from "./productcard";

export type CardStore = {
  version: 1;
  cards: Record<string, ProductCard>;
  byImage: Record<string, string>;
};

const MAX_CARDS = 2000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_URLS_PER_CARD = 20;

type CacheState = {
  store?: CardStore;
  loading?: Promise<CardStore>;
  queue: Promise<void>;
  pending: Map<string, Promise<ProductCard | undefined>>;
};

const holder = globalThis as typeof globalThis & { __tryitProductCache?: CacheState };

function state(): CacheState {
  holder.__tryitProductCache ??= { queue: Promise.resolve(), pending: new Map() };
  return holder.__tryitProductCache;
}

function cacheFile(): string {
  // events.ts dataDir() ile aynı ifade; import edilmiyor ki test yüklenebilsin.
  return join(process.env.TRYIT_DATA_DIR || ".data", "product-cards.json");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function emptyStore(): CardStore {
  return { version: 1, cards: {}, byImage: {} };
}

/** Önbellek anahtarı: boşluklar ve hash kısmı atılır. */
export function normalizeImageUrl(url: string): string {
  const trimmed = url.trim();
  const hash = trimmed.indexOf("#");
  return hash >= 0 ? trimmed.slice(0, hash) : trimmed;
}

/**
 * Süresi geçen ve sayı sınırını aşan en eski kartları atar; artık karta
 * bağlanmayan görsel girişlerini ve hiçbir görsele bağlı olmayan kartları siler.
 */
export function pruneStore(store: CardStore, now: number, max = MAX_CARDS, ttlMs = TTL_MS): CardStore {
  const referenced = new Set(Object.values(store.byImage));
  const live = Object.entries(store.cards)
    .map(([id, card]) => ({ id, card, at: Date.parse(card.createdAt) }))
    .filter(({ id, at }) => referenced.has(id) && Number.isFinite(at) && now - at <= ttlMs)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, max));

  const cards: Record<string, ProductCard> = {};
  for (const { id, card } of live) cards[id] = card;
  const byImage: Record<string, string> = {};
  for (const [url, id] of Object.entries(store.byImage)) {
    if (cards[id]) byImage[url] = id;
  }
  return { version: 1, cards, byImage };
}

function isStore(value: unknown): value is CardStore {
  const v = value as CardStore | null;
  return Boolean(v && v.version === 1 && v.cards && typeof v.cards === "object" && v.byImage && typeof v.byImage === "object");
}

async function readStore(): Promise<CardStore> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cacheFile(), "utf8"));
    if (isStore(parsed)) return pruneStore(parsed, Date.now());
    console.warn("[productcache] dosya biçimi tanınmadı, boş başlanıyor");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[productcache] okunamadı, boş başlanıyor: ${errorText(err)}`);
    }
  }
  return emptyStore();
}

async function loadStore(): Promise<CardStore> {
  const s = state();
  if (s.store) return s.store;
  s.loading ??= readStore().then((store) => {
    s.store = store;
    return store;
  });
  return s.loading;
}

async function writeStore(store: CardStore): Promise<void> {
  const file = cacheFile();
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(tmp, JSON.stringify(store));
  await rename(tmp, file);
}

/** Kartın tarifini istem kurallarından yeniden geçirir; diskteki eski veya elle değişmiş kart da temizlensin. */
async function sanitize(card: ProductCard): Promise<ProductCard> {
  // Dinamik import: bu modül strip-types testinde yalnız yerleşik modüllerle yüklenebilmeli.
  const { cleanDescription } = await import("./productcard");
  return { ...card, description: cleanDescription(card.description ?? "") };
}

export async function getCard(imageUrl: string): Promise<ProductCard | undefined> {
  try {
    const store = await loadStore();
    const id = store.byImage[normalizeImageUrl(imageUrl)];
    const card = id ? store.cards[id] : undefined;
    return card ? await sanitize(card) : undefined;
  } catch (err) {
    console.warn(`[productcache] getCard: ${errorText(err)}`);
    return undefined;
  }
}

function isLive(store: CardStore, id: string | undefined, now: number, ttlMs = TTL_MS): boolean {
  const card = id ? store.cards[id] : undefined;
  if (!card) return false;
  const at = Date.parse(card.createdAt);
  return Number.isFinite(at) && now - at <= ttlMs;
}

/**
 * Kartı ürünün görsel adreslerine (en çok 20) bağlar ve diske sıralı yazar.
 * Canlı bir karta bağlı adres ezilmez (ilk yazan kalır): başka bir sayfa aynı
 * görseli kullanıp yanlış tarifle önbelleği zehirleyemesin.
 */
export async function putCard(imageUrls: string[], card: ProductCard): Promise<void> {
  const s = state();
  try {
    const urls = [...new Set(imageUrls.map(normalizeImageUrl).filter(Boolean))].slice(0, MAX_URLS_PER_CARD);
    if (!urls.length) return;
    await loadStore();
    // Bekleme sırasında başka bir putCard s.store'u yenilemiş olabilir; eski kopyaya yazılmasın.
    const store = s.store ?? emptyStore();
    const now = Date.now();
    const free = urls.filter((url) => !isLive(store, store.byImage[url], now));
    if (!free.length) return;
    const id = randomUUID();
    store.cards[id] = card;
    for (const url of free) store.byImage[url] = id;
    s.store = pruneStore(store, now);
  } catch (err) {
    console.warn(`[productcache] putCard: ${errorText(err)}`);
    return;
  }
  // Yazma anındaki en güncel kopya yazılsın diye store kuyrukta okunuyor.
  const job = s.queue.then(() => writeStore(s.store ?? emptyStore()));
  s.queue = job.catch((err) => console.warn(`[productcache] yazılamadı: ${errorText(err)}`));
  await s.queue;
}

export function pendingCard(imageUrl: string): Promise<ProductCard | undefined> | undefined {
  return state().pending.get(normalizeImageUrl(imageUrl));
}

/** Süren kart üretimini görsel adreslerine bağlar; promise bitince kayıt silinir. */
export function trackPending(imageUrls: string[], promise: Promise<ProductCard | undefined>): void {
  const pending = state().pending;
  const safe = promise.catch((err) => {
    console.warn(`[productcache] bekleyen kart başarısız: ${errorText(err)}`);
    return undefined;
  });
  const urls = [...new Set(imageUrls.map(normalizeImageUrl).filter(Boolean))].slice(0, MAX_URLS_PER_CARD);
  for (const url of urls) pending.set(url, safe);
  void safe.finally(() => {
    for (const url of urls) {
      if (pending.get(url) === safe) pending.delete(url);
    }
  });
}

/** Önbellekte varsa hemen döner; üretim sürüyorsa en çok maxWaitMs bekler; yoksa undefined. */
export async function awaitCard(imageUrl: string, maxWaitMs: number): Promise<ProductCard | undefined> {
  const cached = await getCard(imageUrl);
  if (cached) return cached;
  const pending = pendingCard(imageUrl);
  if (!pending) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(0, maxWaitMs));
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

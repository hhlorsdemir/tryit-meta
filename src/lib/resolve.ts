import { BrowserError, fetchRendered } from "./browser";
import { detectSlot, type Slot } from "./slots";
import { pickVariant, variantSelectorFrom } from "./variant";
import { unwrapShareLink } from "./sharelink";
import { canonicalAmazonUrl, isAmazonHost, readAmazon } from "./amazon";

export type ResolvedProduct = {
  url: string;
  name: string;
  brand?: string;
  price?: string;
  currency?: string;
  /** Sayfada bulunan tüm ürün görselleri, JSON-LD sırasıyla. */
  images: string[];
  /** Linkte bir renk seçiliyse o rengin adı. */
  color?: string;
  slot: Slot;
  /** Yuva tahmini kategori veya isimden geldiyse true, varsayılana düştüyse false. */
  slotConfident: boolean;
  source: "jsonld" | "opengraph" | "amazon" | "spark";
  /** Sayfa düz istekle mi açıldı, tarayıcıda mı oluşturuldu. */
  rendered?: boolean;
  categoryPath?: string[];
  /** Muse Spark ürün kartının tek satır İngilizce tarifi; kart süresinde bittiyse. */
  description?: string;
};

/**
 * Linkin neden çözülemediği. Kullanıcıya gösterilen cümle değişebilir,
 * bu kodlar sabit kalıyor: raporda hangi nedenin kaç kez çıktığını
 * saymak istiyoruz.
 */
export type ResolveCode =
  | "bad-url"
  | "not-http"
  | "private-host"
  | "not-product"
  | "page-blocked"
  | "no-data";

export class ResolveError extends Error {
  readonly code: ResolveCode;

  constructor(message: string, code: ResolveCode) {
    super(message);
    this.name = "ResolveError";
    this.code = code;
  }
}

const MAX_HTML_BYTES = 5 * 1024 * 1024;

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};

/**
 * Amazon sunucu IP'sinden gelen istekte user-agent veya accept başlığı görünce
 * captcha veriyor; yalnız dil başlığıyla sayfanın kendisini döndürüyor.
 */
const AMAZON_HEADERS: Record<string, string> = {
  "accept-language": BROWSER_HEADERS["accept-language"],
};

/**
 * Kullanıcıdan gelen adresi doğrular. Sunucu tarafında fetch yaptığımız için
 * iç ağa istek atılmasını (SSRF) burada engelliyoruz.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ResolveError("Bu bir adres gibi görünmüyor.", "bad-url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ResolveError("Yalnızca http ve https adresleri açılabilir.", "not-http");
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPrivate =
    host === "localhost" ||
    host === "::1" ||
    host === "::" ||
    host === "0.0.0.0" ||
    host.startsWith("::ffff:") ||
    /^0\./.test(host) ||
    /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host);

  if (isPrivate) {
    throw new ResolveError("Yerel ağ adresleri açılamaz.", "private-host");
  }

  return parsed;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Düz istekle sayfayı indirir.
 *
 * Bot koruması olan siteler burada duvara çarpıyor: Trendyol 403 veriyor,
 * Zara doğrulama sayfası döndürüyor. Bu durumda hata fırlatmıyoruz, null
 * dönüp çağıranın tarayıcıya düşmesine izin veriyoruz.
 */
async function fetchHtml(url: URL): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: isAmazonHost(url.hostname) ? AMAZON_HEADERS : BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/html|xml|text/i.test(contentType)) {
    throw new ResolveError("Bu adres bir ürün sayfası değil.", "not-product");
  }

  const html = await res.text();
  return html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html;
}

/** Sayfadaki tüm JSON-LD bloklarını düz bir nesne listesine açar. */
function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(re)) {
    const body = match[1]?.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
    if (!body?.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // Bozuk blokları sessizce atlıyoruz, sayfada başkaları olabilir.
    }

    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const graph = record["@graph"];
      if (Array.isArray(graph)) {
        queue.push(...graph);
        continue;
      }
      blocks.push(record);
    }
  }

  return blocks;
}

/** schema.org'da tek ürün Product, renk ailesi ProductGroup olarak geçiyor. */
const PRODUCT_TYPES = ["Product", "ProductGroup"];

function isProductNode(node: Record<string, unknown>): boolean {
  return PRODUCT_TYPES.some((type) => hasType(node, type));
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const raw = node["@type"];
  if (typeof raw === "string") return raw.toLowerCase() === type.toLowerCase();
  if (Array.isArray(raw)) {
    return raw.some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());
  }
  return false;
}

function toImageList(raw: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      // Trendyol görselleri ImageObject içinde contentUrl dizisi olarak veriyor.
      visit(record["contentUrl"]);
      const url = record["url"];
      if (typeof url === "string") out.push(url);
    }
  };
  visit(raw);
  return out;
}

/**
 * Görseli mümkünse büyük halinden ister.
 *
 * Zara JSON-LD'de 560 piksellik küçük halleri veriyor; giydirme modeline
 * kumaşın dokusu o boyutta ulaşmıyor. Ölçüyü yalnızca kuralını doğruladığımız
 * CDN'lerde değiştiriyoruz, yoksa tanımadığımız bir sunucuda görsel hiç
 * açılmayabilir.
 */
function preferLargeImage(raw: URL): URL {
  if (!raw.hostname.endsWith("static.zara.net")) return raw;

  const width = Number(raw.searchParams.get("w"));
  if (Number.isFinite(width) && width > 0 && width < 1200) {
    raw.searchParams.set("w", "1200");
  }
  return raw;
}

function absolutise(images: string[], base: URL): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const image of images) {
    let resolved: string;
    try {
      resolved = preferLargeImage(new URL(image, base)).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(resolved)) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * Tekliflerin işaret ettiği varyant kimlikleri.
 *
 * Sayfada önerilen ürünlerin varyantları da gömülü duruyor; renge göre
 * eşleştirirken aramayı bu ürünün kendi varyantlarıyla sınırlamak gerekiyor.
 */
function offerVariantIds(raw: unknown): string[] {
  const offers = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];

  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const url = (offer as Record<string, unknown>)["url"];
    if (typeof url !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    for (const key of ["vid", "variant", "variantId", "variant_id"]) {
      const value = parsed.searchParams.get(key)?.trim();
      if (value && !out.includes(value)) out.push(value);
    }
  }

  return out;
}

/**
 * Fiyatı okur. Varyant kimliği verildiyse önce o varyantın teklifi aranıyor;
 * renkler ve bedenler arasında fiyat değişebiliyor.
 */
function readOffer(
  raw: unknown,
  variantId?: string,
  variants?: unknown,
): { price?: string; currency?: string } {
  const offers = Array.isArray(raw) ? raw : [raw];

  const take = (offer: unknown): { price?: string; currency?: string } | undefined => {
    if (!offer || typeof offer !== "object") return undefined;
    const record = offer as Record<string, unknown>;
    const price = record["price"] ?? record["lowPrice"];
    if (price === undefined || price === null || price === "") return undefined;
    const currency = record["priceCurrency"];
    return {
      price: String(price),
      currency: typeof currency === "string" ? currency : undefined,
    };
  };

  if (variantId) {
    for (const offer of offers) {
      const url = offer && typeof offer === "object" ? (offer as Record<string, unknown>)["url"] : undefined;
      if (typeof url !== "string" || !url.includes(variantId)) continue;
      const found = take(offer);
      if (found) return found;
    }
  }

  for (const offer of offers) {
    const found = take(offer);
    if (found) return found;
  }

  // Zara fiyatı üst düzeyde değil, her bedenin kendi teklifinde tutuyor.
  if (Array.isArray(variants)) {
    for (const entry of variants) {
      if (!entry || typeof entry !== "object") continue;
      const nested = (entry as Record<string, unknown>)["offers"];
      for (const offer of Array.isArray(nested) ? nested : [nested]) {
        const found = take(offer);
        if (found) return found;
      }
    }
  }

  return {};
}

function readBreadcrumb(blocks: Record<string, unknown>[]): string[] {
  const list = blocks.find((block) => hasType(block, "BreadcrumbList"));
  const items = list?.["itemListElement"];
  if (!Array.isArray(items)) return [];

  return items
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const record = entry as Record<string, unknown>;
      if (typeof record["name"] === "string") return record["name"];
      const item = record["item"];
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>)["name"] === "string") {
        return (item as Record<string, unknown>)["name"] as string;
      }
      return undefined;
    })
    .filter((name): name is string => Boolean(name));
}

function readMeta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(re) ?? html.match(alt);
  return match?.[1] ? decodeEntities(match[1]) : undefined;
}

/**
 * Ürün sayfasını çözer. Önce schema.org JSON-LD denenir; ikas, Shopify,
 * WooCommerce ve benzeri altyapıların çoğu bunu yayınlıyor. Bulunamazsa
 * Open Graph etiketlerine düşer.
 */
type Extraction =
  | { kind: "ok"; product: ResolvedProduct }
  | { kind: "not-product" }
  | { kind: "empty" };

/** Marka bazen düz metin, bazen Brand nesnesi, Trendyol'da manufacturer. */
function readBrand(product: Record<string, unknown>): string | undefined {
  const candidates = [product["brand"], product["manufacturer"]];
  for (const raw of candidates) {
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (raw && typeof raw === "object") {
      const name = (raw as Record<string, unknown>)["name"];
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return undefined;
}

/**
 * Sayfadan ürünü çıkarmayı dener.
 *
 * Üç sonuç var: ürün bulundu, sayfa okundu ama ürün sayfası değil, ya da
 * sayfada işimize yarar hiçbir şey yok. Üçüncüsünde çağıran taraf sayfayı
 * bir de tarayıcıda açmayı deniyor; içerik istemci tarafında geliyor olabilir.
 */
function extract(html: string, url: URL): Extraction {
  const blocks = extractJsonLd(html);
  const categoryPath = readBreadcrumb(blocks);
  const selector = variantSelectorFrom(url);

  // Zara ve Trendyol renk ailesini ProductGroup olarak yayınlıyor; tek
  // parçalı mağazalar Product kullanıyor. İkisini de kabul edip içinde
  // adı ve görseli olan ilkini alıyoruz.
  const product = blocks.filter(isProductNode).find((block) => {
    const name = block["name"];
    return typeof name === "string" && name.trim() !== "" && toImageList(block["image"]).length > 0;
  });

  if (product) {
    const defaults = absolutise(toImageList(product["image"]), url);

    // Linkte bir renk seçiliyse sayfanın varsayılan görselleri yanlış rengi
    // gösteriyor; varyantın kendi görsellerini öne alıyoruz.
    const variant = pickVariant(html, selector, offerVariantIds(product["offers"]), defaults[0]);
    const images = variant?.images.length ? absolutise(variant.images, url) : defaults;

    const baseName = decodeEntities(String(product["name"]));
    // Renk isme giriyor: kart hangi rengin denendiğini gösteriyor ve
    // giydirme istemi de kıyafeti o adla anıyor.
    const name =
      variant?.color && !baseName.toLocaleLowerCase("tr").includes(variant.color.toLocaleLowerCase("tr"))
        ? `${baseName} (${variant.color})`
        : baseName;

    if (images.length) {
      const { price, currency } = readOffer(product["offers"], variant?.id ?? selector.id, product["hasVariant"]);
      const brand = readBrand(product);
      const { slot, confident } = detectSlot({ name: baseName, brand, categoryPath, url: url.pathname });

      return {
        kind: "ok",
        product: {
          url: url.toString(),
          name,
          brand,
          price,
          currency,
          images,
          color: variant?.color,
          slot,
          slotConfident: confident,
          source: "jsonld",
          categoryPath: categoryPath.length ? categoryPath : undefined,
        },
      };
    }
  }

  // Amazon JSON-LD ve Open Graph yayınlamıyor; kendi okuyucusu var.
  if (isAmazonHost(url.hostname)) {
    const amazon = readAmazon(html, url);
    if (amazon) {
      const { slot, confident } = detectSlot({
        name: amazon.name,
        brand: amazon.brand,
        categoryPath: amazon.categoryPath,
        url: url.pathname,
      });
      return {
        kind: "ok",
        product: { ...amazon, slot, slotConfident: confident, source: "amazon" },
      };
    }
  }

  // JSON-LD yoksa veya eksikse Open Graph ile idare ediyoruz. Kategori
  // sayfaları da og:title ve og:image taşıdığı için burada bir fiyat ya da
  // og:type=product işareti arıyoruz; yoksa bunu ürün saymıyoruz.
  const ogTitle = readMeta(html, "og:title");
  const ogImage = readMeta(html, "og:image");
  const ogType = readMeta(html, "og:type") ?? "";
  const ogPrice = readMeta(html, "product:price:amount") ?? readMeta(html, "og:price:amount");
  const ogCurrency =
    readMeta(html, "product:price:currency") ?? readMeta(html, "og:price:currency");

  if (ogTitle && ogImage) {
    if (!/product|item/i.test(ogType) && !ogPrice) return { kind: "not-product" };

    const images = absolutise([ogImage], url);
    if (images.length) {
      const { slot, confident } = detectSlot({ name: ogTitle, categoryPath, url: url.pathname });
      return {
        kind: "ok",
        product: {
          url: url.toString(),
          name: ogTitle,
          price: ogPrice,
          currency: ogCurrency,
          images,
          slot,
          slotConfident: confident,
          source: "opengraph",
          categoryPath: categoryPath.length ? categoryPath : undefined,
        },
      };
    }
  }

  return { kind: "empty" };
}

/**
 * Ürün sayfasını çözer.
 *
 * Önce düz istek deneniyor; ucuz ve hızlı. Sayfa bot koruması yüzünden
 * açılmazsa ya da açılıp içinden ürün çıkmazsa aynı adres başsız tarayıcıda
 * bir daha açılıyor. Okunan ama ürün olmadığı belli olan sayfalarda
 * (kategori sayfaları gibi) tarayıcıya hiç gitmiyoruz, boşuna yirmi saniye
 * beklemeyelim.
 */
export async function resolveProduct(rawUrl: string): Promise<ResolvedProduct> {
  return (await resolveProductWithPage(rawUrl)).product;
}

const NOT_PRODUCT_MESSAGE = "Bu bir ürün sayfası değil gibi görünüyor. Tek bir ürünün linkini deneyin.";
/** Spark yedeği için kalması gereken en az süre; indirme ve model çağrısı buna sığmalı. */
const SPARK_MIN_BUDGET_MS = 8_000;
const BROWSER_MIN_BUDGET_MS = 8_000;
/** Çağıran bütçe vermezse route'un 25 sn'lik bütçesiyle aynı. */
const DEFAULT_BUDGET_MS = 25_000;

export type ResolvedPage = { product: ResolvedProduct; html: string; spark?: { ms: number; costUsd: number } };

type SparkStep =
  | { kind: "ok"; page: ResolvedPage }
  | { kind: "not-product"; spark: { ms: number; costUsd: number } }
  | { kind: "skip" };

/**
 * Yapılı veri yoksa sayfa metni Spark'a gider. Hata yutulur: yedek çalışmazsa
 * eski akış (tarayıcı, sonra no-data) sürer.
 */
async function trySpark(html: string, url: URL, deadline: number, rendered: boolean): Promise<SparkStep> {
  if (deadline - Date.now() < SPARK_MIN_BUDGET_MS) return { kind: "skip" };
  try {
    const { sparkResolve } = await import("./sparkresolve");
    const result = await sparkResolve({ html, url, deadline });
    if (result.kind === "skip") return { kind: "skip" };
    const spark = { ms: result.ms, costUsd: result.costUsd };
    if (result.kind === "not-product") return { kind: "not-product", spark };
    const product = rendered ? { ...result.product, rendered: true } : result.product;
    return { kind: "ok", page: { product, html, spark } };
  } catch (err) {
    console.warn(`[resolve] Spark yedeği başarısız: ${err instanceof Error ? err.message : err}`);
    return { kind: "skip" };
  }
}

/** Spark sayfanın ürün olmadığına karar verdi; maliyet olayda görünsün diye hata üstünde taşınıyor. */
export class SparkNotProductError extends ResolveError {
  readonly spark: { ms: number; costUsd: number };

  constructor(spark: { ms: number; costUsd: number }) {
    super(NOT_PRODUCT_MESSAGE, "not-product");
    this.spark = spark;
  }
}

/** resolveProduct ile aynı; ürün kartı sayfa metnini istediği için HTML de dönüyor. */
export async function resolveProductWithPage(rawUrl: string, opts: { deadline?: number } = {}): Promise<ResolvedPage> {
  const deadline = opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  // Paylaş menüsünün kısa linki (ty.gl gibi) önce asıl ürün adresine açılıyor.
  const unwrapped = await unwrapShareLink(assertPublicHttpUrl(rawUrl), assertPublicHttpUrl);
  // Amazon linklerindeki izleme parametreleri sunucudan gitmesin.
  const url = isAmazonHost(unwrapped.hostname) ? canonicalAmazonUrl(unwrapped) : unwrapped;

  const plain = await fetchHtml(url);
  if (plain) {
    const first = extract(plain, url);
    if (first.kind === "ok") return { product: first.product, html: plain };
    if (first.kind === "not-product") throw new ResolveError(NOT_PRODUCT_MESSAGE, "not-product");
    // Tarayıcıdan önce Spark: sayfa okunmuş, yalnız yapılı veri yok.
    const step = await trySpark(plain, url, deadline, false);
    if (step.kind === "ok") return step.page;
    if (step.kind === "not-product") throw new SparkNotProductError(step.spark);
  }

  // Tarayıcı 30 sn sürebilir; maxDuration aşılmasın diye kalan süre yetmiyorsa denenmiyor.
  if (opts.deadline !== undefined && deadline - Date.now() < BROWSER_MIN_BUDGET_MS) {
    throw new ResolveError("Bu sayfadan ürün bilgisi çıkarılamadı.", "no-data");
  }

  let html: string;
  try {
    html = await fetchRendered(url, opts.deadline !== undefined ? deadline - Date.now() - 1_000 : undefined);
  } catch (err) {
    if (err instanceof BrowserError) throw new ResolveError(err.message, "page-blocked");
    throw new ResolveError("Sayfa açılamadı.", "page-blocked");
  }

  const second = extract(html, url);
  if (second.kind === "ok") return { product: { ...second.product, rendered: true }, html };
  if (second.kind === "not-product") throw new ResolveError(NOT_PRODUCT_MESSAGE, "not-product");

  const step = await trySpark(html, url, deadline, true);
  if (step.kind === "ok") return step.page;
  if (step.kind === "not-product") throw new SparkNotProductError(step.spark);
  throw new ResolveError("Bu sayfadan ürün bilgisi çıkarılamadı.", "no-data");
}

/**
 * Linkteki renk seçimini çözer.
 *
 * Ürün sayfasının JSON-LD'si her zaman varsayılan varyantı gösteriyor.
 * Fetely (ikas) üzerinde link ister ?vid=<varyant> ister
 * ?beden=s&renk-1087=lacivert biçiminde olsun, sunucu hep aynı Product.image
 * ve aynı og:image ile dönüyor; ikinci biçimde og:url bile istenen rengi
 * değil varsayılanı yazıyor. Doğru renge ulaşmanın tek yolu sayfaya gömülü
 * varyant listesini okumak.
 */

export type PickedVariant = {
  /** Seçilen varyantın kimliği; fiyatı da bu varyantın teklifinden okuyoruz. */
  id: string;
  /** Varyantın kendi görselleri, sayfadaki sırasıyla. */
  images: string[];
  /** Renk adı; ürün ismine ekleniyor, giydirme istemine de o isimle gidiyor. */
  color?: string;
};

const VARIANT_PARAMS = ["vid", "variant", "variantId", "variant_id"];

/** Ürünle ilgisi olmayan, izleme amaçlı parametreler. */
const NOISE_PARAMS = /^(utm_|gclid|fbclid|msclkid|srsltid|ref|referrer|yclid|_branch)/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VariantSelector = {
  /** Varyant kimliği verilmişse. */
  id?: string;
  /** Öznitelik değerleri: "lacivert", "s" gibi. */
  values: string[];
};

/** Türkçe harfleri sadeleştirip karşılaştırılabilir bir anahtar üretir. */
function slug(raw: string): string {
  return raw
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Adresteki renk ve beden seçimini toplar.
 *
 * İki biçim görülüyor: varyantı doğrudan kimliğiyle veren `?vid=...` ve
 * özniteliğiyle veren `?beden=s&renk-1087=lacivert`. İkincisinde parametre
 * adı mağazadan mağazaya değiştiği için ada değil, değere bakıyoruz.
 */
export function variantSelectorFrom(url: URL): VariantSelector {
  let id: string | undefined;
  const values: string[] = [];

  for (const [key, raw] of url.searchParams) {
    const value = raw.trim();
    if (!value) continue;

    if (VARIANT_PARAMS.includes(key)) {
      id ??= value;
      continue;
    }
    if (NOISE_PARAMS.test(key)) continue;

    const normalised = slug(value);
    if (normalised && !values.includes(normalised)) values.push(normalised);
  }

  return { id, values };
}

type RawImage = {
  imageId?: unknown;
  fileName?: unknown;
  order?: unknown;
  isVideo?: unknown;
};

type RawVariant = {
  id?: unknown;
  images?: unknown;
  variantValues?: unknown;
};

/**
 * Verilen anahtardan sonra gelen JSON dizisini çıkarır.
 *
 * Parantez sayarken metin içindekileri atlamak gerekiyor; ürün adında bir
 * köşeli parantez geçtiğinde sayaç şaşıyor ve blok yarısından kesiliyor.
 */
function arraysAfterKey(html: string, key: string, maxBytes = 2 * 1024 * 1024): unknown[][] {
  const out: unknown[][] = [];
  const needle = `"${key}":`;

  let from = 0;
  while (true) {
    const at = html.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;

    const open = html.indexOf("[", from);
    if (open < 0) break;
    // Anahtar ile köşeli parantez arasında boşluktan başka bir şey varsa
    // bu bir dizi değil.
    if (html.slice(from, open).trim() !== "") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = open; i < html.length && i - open < maxBytes; i += 1) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end < 0) continue;
    try {
      const parsed = JSON.parse(html.slice(open, end + 1));
      if (Array.isArray(parsed)) out.push(parsed);
    } catch {
      // Sayfada birden fazla varyant bloğu var, bozuk olanı atlıyoruz.
    }
    from = end + 1;
  }

  return out;
}

/** Sayfadaki tüm varyantları kimliğe göre indeksler. */
function indexVariants(html: string): Map<string, RawVariant> {
  const out = new Map<string, RawVariant>();
  for (const array of arraysAfterKey(html, "variants")) {
    for (const entry of array) {
      if (!entry || typeof entry !== "object") continue;
      const variant = entry as RawVariant;
      if (typeof variant.id === "string" && !out.has(variant.id)) out.set(variant.id, variant);
    }
  }
  return out;
}

/** Varyantın renk ve beden adları, karşılaştırma için sadeleşmiş hâlde. */
function valueKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim()) out.push(slug(name));
  }
  return out;
}

/**
 * Öznitelik değerlerine en çok uyan varyantı seçer.
 *
 * Yalnızca bu ürüne ait varyantlar arasında arıyoruz; sayfada önerilen
 * ürünlerin varyantları da gömülü duruyor ve onlarda da "Lacivert" geçiyor.
 */
function matchByValues(
  variants: Map<string, RawVariant>,
  candidates: string[],
  values: string[],
): string | undefined {
  let best: string | undefined;
  let bestScore = 0;

  for (const id of candidates) {
    const variant = variants.get(id);
    if (!variant) continue;
    const keys = valueKeys(variant.variantValues);
    const score = values.filter((value) => keys.includes(value)).length;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : undefined;
}

/**
 * Örnek bir görsel adresinden ikas CDN kalıbını çıkarır.
 *
 * Kalıp şöyle: /images/<magaza>/<gorselId>/<boy>/<dosya>.<uzanti>
 * Varyantın görselleri sayfada yalnızca gorselId ve dosya adı olarak
 * duruyor, tam adresi bu kalıpla kuruyoruz.
 */
function cdnTemplate(sample: string): ((imageId: string, fileName: string) => string) | undefined {
  let url: URL;
  try {
    url = new URL(sample);
  } catch {
    return undefined;
  }

  if (url.hostname !== "cdn.myikas.com") return undefined;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return undefined;

  const [imageId, size, file] = parts.slice(-3);
  if (!UUID.test(imageId) || !/^\d+$/.test(size)) return undefined;

  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1) : "webp";
  const prefix = parts.slice(0, -3).join("/");

  return (nextId, nextFile) =>
    `${url.origin}/${prefix}/${nextId}/${size}/${encodeURIComponent(nextFile)}.${ext}`;
}

function readColor(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    // Beden ile renk aynı listede duruyor; rengi olanın renk kodu dolu.
    const code = value["colorCode"];
    const name = value["name"];
    if (typeof code === "string" && code.trim() && typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }
  return undefined;
}

function readImages(raw: unknown, build: (id: string, file: string) => string): string[] {
  if (!Array.isArray(raw)) return [];

  const rows = raw
    .filter((entry): entry is RawImage => Boolean(entry) && typeof entry === "object")
    .filter((entry) => entry.isVideo !== true)
    .filter(
      (entry): entry is RawImage & { imageId: string; fileName: string } =>
        typeof entry.imageId === "string" &&
        UUID.test(entry.imageId) &&
        typeof entry.fileName === "string" &&
        entry.fileName.trim() !== "",
    )
    .sort((a, b) => {
      const left = typeof a.order === "number" ? a.order : 0;
      const right = typeof b.order === "number" ? b.order : 0;
      return left - right;
    });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const url = build(row.imageId, row.fileName);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Sayfadan seçilen varyantı okur. Bulamazsa undefined döner ve çağıran
 * taraf varsayılan görselleri kullanmaya devam eder.
 *
 * `candidates` bu ürünün JSON-LD tekliflerinden gelen varyant kimlikleri.
 */
export function pickVariant(
  html: string,
  selector: VariantSelector,
  candidates: string[],
  sampleImage?: string,
): PickedVariant | undefined {
  if (!selector.id && !selector.values.length) return undefined;

  const variants = indexVariants(html);

  // Öznitelikle eşleştirmeyi yalnızca bu ürünün varyant kimlikleri
  // elimizdeyken yapıyoruz. Aday listesi yoksa sayfadaki her varyanta
  // bakmak gerekir ki önerilen ürünlerinki de oraya dahil; "lacivert"
  // başka bir ürüne denk gelip yanlış renk etiketi yazdırabilir.
  const id =
    selector.id && variants.has(selector.id)
      ? selector.id
      : candidates.length
        ? matchByValues(variants, candidates, selector.values)
        : undefined;

  const variant = id ? variants.get(id) : undefined;
  if (!id || !variant) return undefined;

  const build = sampleImage ? cdnTemplate(sampleImage) : undefined;
  const images = build ? readImages(variant.images, build) : [];
  const color = readColor(variant.variantValues);

  if (!images.length && !color) return undefined;
  return { id, images, color };
}

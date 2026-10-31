import { readFile, utimes } from "node:fs/promises";
import sharp from "sharp";
import { localMediaPath, saveMedia } from "./media";
import {
  DOWNLOAD_TIMEOUT_MS,
  MetaConfigError,
  MUSE_COST_USD,
  assertMetaKey,
  museEdit,
  type ImageInput,
} from "./meta";
import { ResolveError, assertPublicHttpUrl } from "./resolve";
import { SLOT_EN, type Slot } from "./slots";

export type GarmentInput = {
  slot: Slot;
  name: string;
  image: string;
  /** Ürünün kısa tarifi (H-005). Varsa istemde adın yanına ekleniyor. */
  description?: string;
};

/** Giydirmenin neden olmadığı. Raporda bu kodlar sayılıyor. */
export type TryOnCode =
  | "no-garments"
  | "too-many"
  | "bad-garment"
  | "no-avatar"
  | "model-failed"
  | "content-filtered"
  | "no-image";

export class TryOnError extends Error {
  readonly code: TryOnCode;
  /** Yalnız günlüğe giden teknik ayrıntı (ör. Meta'nın hata gövdesi); kullanıcıya gösterilmez. */
  readonly detail?: string;

  constructor(message: string, code: TryOnCode, detail?: string) {
    super(message);
    this.name = "TryOnError";
    this.code = code;
    this.detail = detail;
  }
}

export type AspectRatio =
  | "auto"
  | "21:9"
  | "16:9"
  | "3:2"
  | "4:3"
  | "5:4"
  | "1:1"
  | "4:5"
  | "3:4"
  | "2:3"
  | "9:16";

/** Modelin kabul ettiği en boy oranları ve sayısal karşılıkları. */
const ASPECT_RATIOS: Array<[AspectRatio, number]> = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["5:4", 5 / 4],
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
];

/**
 * Avatarın oranına en yakın desteklenen değeri seçer.
 *
 * Oranı "auto" bırakmak güvenilir çıkmadı: aynı avatarla, yalnızca kıyafet
 * görselleri değiştiğinde model bir seferinde 2:3, bir seferinde kare üretti
 * ve kare olanda kadraj genişleyip kişi küçüldü. Oranı açıkça vermek bunu
 * sabitliyor.
 */
export function nearestAspectRatio(width: number, height: number): AspectRatio {
  if (!(width > 0) || !(height > 0)) return "auto";
  const target = width / height;
  let best = ASPECT_RATIOS[0];
  for (const candidate of ASPECT_RATIOS) {
    if (Math.abs(candidate[1] - target) < Math.abs(best[1] - target)) best = candidate;
  }
  return best[0];
}

// Tarif yalnız parçayı fotoğrafta bulmaya yardım etsin; görünüşü tarif
// değil fotoğraf belirlesin, yoksa model tarifteki rengi veya deseni uyduruyor.
const DESCRIPTION_RULE =
  "The descriptions only help you find the right garment in each photo. The product photo is the authority on how it looks: if a description and its photo disagree, follow the photo. Use only the named garment from each photo and ignore anything else the model in it wears.";

function descriptionRule(garments: GarmentInput[]): string[] {
  return garments.some((garment) => garment.description) ? ["", DESCRIPTION_RULE] : [];
}

/**
 * Giydirme istemini kurar. Görseller modele sıralı gidiyor: 1 numara kişi,
 * sonrakiler kıyafetler. Bu yüzden istem de görselleri numarayla anıyor.
 */
export function buildPrompt(garments: GarmentInput[]): string {
  const lines = garments.map((garment, index) => {
    const head = `Image ${index + 2} shows the ${SLOT_EN[garment.slot]} to put on the person: "${garment.name}"`;
    return garment.description ? `${head} (${garment.description}).` : `${head}.`;
  });

  return [
    "Virtual try-on.",
    "Image 1 is the person.",
    "",
    ...lines,
    "",
    "Dress the person from image 1 in these garments. Reproduce each garment exactly as it appears in its product photo: same colour, fabric texture, knit or weave pattern, print and graphics, buttons, zips, drawstrings, collar, cuffs, hem, length and fit.",
    ...descriptionRule(garments),
    "",
    "Keep the person from image 1 exactly as they are: same face, hair, facial hair, skin tone, body shape and proportions, height, pose, hands, background, lighting and camera framing. Keep any clothing item that is not being replaced.",
    "",
    // Nesne adlarını tek tek saymak modeli o nesneyi uydurmaya itiyor: istemde
    // "eyewear" geçtiği için gözlük takmayan kişiye gözlük eklemişti. Artık
    // sayım yok, bunun yerine açık bir yasak var.
    "Add nothing to the person that is not already visible in image 1. Do not add glasses, sunglasses, a hat, a watch, jewellery or a bag, and do not remove any such item if the person is already wearing one.",
    "",
    "Do not copy the face, hair, body or pose of any model shown in the product photos. Those photos are references for the clothing only.",
    "",
    "Return one photorealistic full-body photograph of the person wearing the outfit.",
  ].join("\n");
}

/** Giydirmeyi yapan motor; günlükte ve cevapta görünüyor. */
export type TryOnProvider = "muse";

export type TryOnStages = {
  museMs?: number;
};

export type TryOnResult = {
  imageUrl: string;
  requestId: string;
  prompt: string;
  provider: TryOnProvider;
  costUsd: number;
  stages?: TryOnStages;
};

type TryOnOptions = {
  avatarUrl: string;
  garments: GarmentInput[];
  aspectRatio?: AspectRatio;
  /** Sonuç adresinin kökü (ör. https://alan.adi); route publicBaseUrl ile veriyor. */
  baseUrl: string;
};

/**
 * Kombini üretir. Her çağrı her zaman orijinal avatardan başlar; parçalar
 * üst üste giydirilmez. Testlerde tek seferde üst ve alt giydirmenin
 * çalıştığını gördük, zincirleme yapmak yalnızca kalite kaybı biriktirirdi.
 */
// ---------------------------------------------------------------- Muse Image

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Route maxDuration 300 s; yükleme ve cevap için pay bırakılıyor. */
const MUSE_BUDGET_MS = 230_000;
const MAX_SIDE = 1536;
const MUSE_FAILED = "Giydirme başarısız, lütfen tekrar deneyin.";

type InputCode = "no-avatar" | "bad-garment";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Yönlendirmeleri elle izler; her adresin herkese açık olduğunu doğrular ki
 * dış bir adres sunucuyu iç ağa yönlendiremesin (SSRF).
 */
async function fetchPublic(url: string, signal: AbortSignal, code: InputCode, what: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      assertPublicHttpUrl(current);
    } catch (err) {
      if (err instanceof ResolveError) throw new TryOnError(`${what} adresi geçersiz.`, code, err.code);
      throw err;
    }
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual", signal });
    } catch (err) {
      // Testte sunucu yeniden başlatıldıktan sonraki ilk istek bir kez "fetch failed"
      // verdi (soğuk DNS veya bağlantı havuzu); tek bir yeniden deneme yetiyor.
      if (signal.aborted) throw new TryOnError(`${what} indirilemedi.`, "model-failed", errorText(err));
      try {
        response = await fetch(current, { redirect: "manual", signal });
      } catch (again) {
        throw new TryOnError(`${what} indirilemedi.`, "model-failed", errorText(again));
      }
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    current = new URL(location, current).toString();
  }
  throw new TryOnError(`${what} indirilemedi.`, code, "Çok fazla yönlendirme.");
}

/** Gövdeyi akıştan okur; sınır aşılınca indirmeyi keser. */
async function readLimited(response: Response, code: InputCode, what: string): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new TryOnError(`${what} çok büyük.`, code);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof TryOnError) throw err;
    throw new TryOnError(`${what} indirilemedi.`, "model-failed", errorText(err));
  }
  return Buffer.concat(chunks);
}

/**
 * Girdi görselini indirir. Kalıcı hatalarda (404/410, görsel olmayan içerik,
 * aşırı boyut) çağıranın kodu döner: avatar için no-avatar ki iOS bayat avatarı
 * yeniden yükleyip denesin, ürün için bad-garment. Geçici hatalar (ağ, zaman
 * aşımı, 429, 5xx) model-failed; avatarı boşuna yeniden yükletmesin.
 */
async function downloadImage(url: string, code: InputCode): Promise<Buffer> {
  const what = code === "no-avatar" ? "Avatar" : "Kıyafet görseli";
  const response = await fetchPublic(url, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), code, what);
  if (!response.ok) {
    await response.body?.cancel();
    const transient = response.status === 429 || response.status >= 500;
    throw new TryOnError(`${what} indirilemedi (${response.status}).`, transient ? "model-failed" : code);
  }

  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("image/")) {
    await response.body?.cancel();
    throw new TryOnError(`${what} bir görsel değil.`, code);
  }
  if (Number(response.headers.get("content-length") ?? 0) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new TryOnError(`${what} çok büyük.`, code);
  }
  return readLimited(response, code, what);
}

/** Görseli okur, EXIF yönünü uygular, uzun kenarı maxSide'a indirir ve JPEG'e çevirir. */
async function fitForMuse(buffer: Buffer, maxSide: number): Promise<ImageInput> {
  // Sıkıştırılmış küçük dosya devasa piksel sayısına açılıp belleği tüketmesin.
  const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/** Bizim medya adresimizse diskten, değilse ağdan okur. */
async function loadImage(url: string, code: InputCode): Promise<Buffer> {
  const local = await localMediaPath(url);
  if (!local) return downloadImage(url, code);
  try {
    const buffer = await readFile(local);
    // Kullanılan avatar 30 günlük süreyi yeniler; süre son kullanımdan sayılır.
    const now = new Date();
    utimes(local, now, now).catch(() => {});
    return buffer;
  } catch (err) {
    throw new TryOnError(code === "no-avatar" ? "Avatar okunamadı." : "Kıyafet görseli okunamadı.", code, errorText(err));
  }
}

async function prepareImage(url: string, code: InputCode): Promise<ImageInput> {
  const buffer = await loadImage(url, code);
  try {
    return await fitForMuse(buffer, MAX_SIDE);
  } catch {
    throw new TryOnError(code === "no-avatar" ? "Avatar okunamadı." : "Kıyafet görseli okunamadı.", code);
  }
}

/** Sonucu diske kaydeder ve mutlak adresini döner. */
async function storeResult(image: Buffer, baseUrl: string): Promise<string> {
  try {
    const name = await saveMedia(image, "jpg");
    return `${baseUrl}/api/media/${name}`;
  } catch (err) {
    throw new TryOnError(MUSE_FAILED, "model-failed", errorText(err).slice(0, 200));
  }
}

/** Muse çıktısını avatar boyutuna ölçekleyip JPEG'e çevirir. */
async function plainMuseImage(museOutput: Buffer, avatar: ImageInput): Promise<Buffer> {
  try {
    return await sharp(museOutput)
      .resize(avatar.width, avatar.height, { fit: "fill" })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (err) {
    throw new TryOnError(MUSE_FAILED, "model-failed", `Muse çıktısı okunamadı: ${errorText(err)}`.slice(0, 200));
  }
}

/**
 * Muse içerik süzgeci isteği reddetti. Canlıda görülen durum: iç çamaşırlı
 * avatara yalnız üst giydirilince sonuç iç çamaşırlı kalacağı için her
 * seferinde reddediliyor; tarifsiz tekrar da reddedildi ve yalnız bekleme
 * süresini ikiye katlıyordu. Bu yüzden tekrar yok, kullanıcıya ne
 * yapacağını söyleyen ayrı bir kod dönüyor.
 */
export function isContentFiltered(err: unknown): boolean {
  if (err instanceof MetaConfigError) return false;
  return errorText(err).includes("[content_policy_violation]");
}

const CONTENT_FILTERED =
  "Bu fotoğrafla bu kombin oluşturulamadı. Günlük kıyafetlerle çekilmiş bir fotoğraf dene ya da kombine bir alt parça da ekle.";

/** Muse başarısız oldu: içerik süzgeci ayrı kodla, gerisi model-failed. */
function museFailed(err: unknown): never {
  const detail = errorText(err).slice(0, 200);
  if (isContentFiltered(err)) {
    throw new TryOnError(CONTENT_FILTERED, "content-filtered", detail);
  }
  throw new TryOnError(MUSE_FAILED, "model-failed", detail);
}

/**
 * Kombini Muse Image ile üretir. Her çağrı her zaman orijinal avatardan
 * başlar; parçalar üst üste giydirilmez, zincirleme yalnızca kalite kaybı
 * biriktirirdi. aspectRatio burada yok sayılıyor: Muse oranı `size` ile
 * avatardan alıyor ve çıktı her durumda avatar boyutuna ölçekleniyor.
 */
export async function generateTryOn(opts: TryOnOptions): Promise<TryOnResult> {
  const started = Date.now();
  const deadline = started + MUSE_BUDGET_MS;
  if (!opts.garments.length) {
    throw new TryOnError("En az bir kıyafet gerekiyor.", "no-garments");
  }
  assertMetaKey();

  const prompt = buildPrompt(opts.garments);
  const [avatar, ...garments] = await Promise.all([
    prepareImage(opts.avatarUrl, "no-avatar"),
    ...opts.garments.map((garment) => prepareImage(garment.image, "bad-garment")),
  ]);

  const museStarted = Date.now();
  let museOutput: Buffer;
  try {
    museOutput = await museEdit({ prompt, avatar, garments, deadline });
  } catch (err) {
    if (err instanceof MetaConfigError) throw err;
    museFailed(err);
  }
  const stages: TryOnStages = { museMs: Date.now() - museStarted };

  const image = await plainMuseImage(museOutput, avatar);
  const imageUrl = await storeResult(image, opts.baseUrl);
  return { imageUrl, requestId: crypto.randomUUID(), prompt, provider: "muse", costUsd: MUSE_COST_USD, stages };
}

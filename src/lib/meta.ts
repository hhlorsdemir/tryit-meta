/**
 * Meta Model API istemcisi: Muse Image düzenleme ve Responses yardımcıları.
 * scripts/muse-test.mjs içinde 29 Ekim'de gerçek koşuda doğrulanan yöntemin
 * birebir TypeScript karşılığı; algoritma değiştirilmedi.
 */

export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaConfigError";
  }
}

const META_BASE = "https://api.meta.ai/v1";
const MUSE_MODEL = "muse-image-1.0";

/** Tahmini birim fiyat (USD), Meta fiyat sayfasından. */
export const MUSE_COST_USD = 0.01;

const MUSE_TIMEOUT_MS = 180_000;
/** Görsel indirme zaman aşımı; tryon.ts girdi indirmesi de bunu kullanıyor. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Yeniden deneme beklemesinin üst sınırı ve denemeye değecek en az kalan süre. */
const MAX_RETRY_WAIT_MS = 15_000;
const MIN_RETRY_BUDGET_MS = 30_000;

export type ImageInput = { buffer: Buffer; width: number; height: number };

// ---------------------------------------------------------------- HTTP

function metaKey(): string {
  const key = process.env.META_API_KEY;
  if (!key) throw new MetaConfigError("META_API_KEY tanımlı değil. .env.local dosyasına anahtarı ekleyin.");
  return key;
}

/** Anahtar yoksa MetaConfigError fırlatır; çağıran para harcayan işe başlamadan önce bakar. */
export function assertMetaKey(): void {
  metaKey();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Zaman aşımı (${ms} ms): ${new URL(url).host}`);
    throw new Error(`Ağ hatası (${new URL(url).host}): ${errorMessage(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** fetchWithTimeout gibi, ama süre gövdenin okunmasını da kapsar: yavaş akan gövde sonsuza kadar beklemesin. */
async function fetchTextWithTimeout(url: string, init: RequestInit, ms: number): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, text: await res.text() };
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Zaman aşımı (${ms} ms): ${new URL(url).host}`);
    throw new Error(`Ağ hatası (${new URL(url).host}): ${errorMessage(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, {}, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Çıktı indirilemedi (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

function dataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

type MetaError = { error?: { message?: string; code?: string } };

/** Bütçe verildiyse istek zaman aşımı kalan süreyi geçmesin. */
function budgetedTimeout(timeoutMs: number, deadline?: number): number {
  if (deadline === undefined) return timeoutMs;
  const left = deadline - Date.now();
  if (left <= 0) throw new Error("Süre bütçesi doldu.");
  return Math.min(timeoutMs, left);
}

/** Yeniden denemeye değer mi: bekleme sonrası en az MIN_RETRY_BUDGET_MS kalmalı. */
function retryWait(res: Response, deadline?: number): number | null {
  const wait = Math.min(Number(res.headers.get("retry-after")) * 1000 || 5000, MAX_RETRY_WAIT_MS);
  if (deadline !== undefined && deadline - Date.now() - wait < MIN_RETRY_BUDGET_MS) return null;
  return wait;
}

/** Meta'ya JSON POST; 429 ve 5xx'te bütçe yetiyorsa bir kez bekleyip yeniden dener. */
export async function metaPost(path: string, body: unknown, timeoutMs: number, deadline?: number): Promise<unknown> {
  const key = metaKey();
  for (let attempt = 1; ; attempt += 1) {
    const { res, text } = await fetchTextWithTimeout(
      `${META_BASE}${path}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      budgetedTimeout(timeoutMs, deadline),
    );
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Hata gövdesi JSON olmayabilir; aşağıda düz metin olarak raporlanır.
    }
    if (res.ok && json) return json;

    const retryable = res.status === 429 || res.status >= 500;
    const wait = retryable && attempt < 2 ? retryWait(res, deadline) : null;
    if (wait !== null) {
      console.warn(`[meta] ${path} ${res.status}, ${wait} ms sonra yeniden deneniyor`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const err = (json as MetaError | null)?.error;
    const detail = err?.message ?? text.slice(0, 300);
    const code = err?.code ? ` [${err.code}]` : "";
    throw new Error(`${path} ${res.status}${code}: ${detail}`);
  }
}

// ---------------------------------------------------------------- Muse Image

/**
 * Muse Image düzenleme isteği. Uç maske parametresi almıyor (dokümana göre
 * multipart'ta mask 400 unsupported_parameter döner); size yalnız oranı belirler.
 * Araçlar kapalı: web'den görsel arayıp referansa katması kıyafet sadakatini bozar.
 */
function museEditBody(prompt: string, avatar: ImageInput, garments: ImageInput[]) {
  return {
    model: MUSE_MODEL,
    prompt,
    images: [avatar, ...garments].map((image) => ({ image_url: dataUrl(image.buffer) })),
    n: 1,
    size: `${avatar.width}x${avatar.height}`,
    response_format: "b64_json",
    output_format: "jpeg",
    tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  };
}

type MuseResponse = { data?: { b64_json?: string; url?: string }[] };

/** Avatarı ürün görselleriyle giydirir; çıktı JPEG. `deadline` verilirse istek onu aşmaz. */
export async function museEdit(opts: {
  prompt: string;
  avatar: ImageInput;
  garments: ImageInput[];
  deadline?: number;
}): Promise<Buffer> {
  const body = museEditBody(opts.prompt, opts.avatar, opts.garments);
  const json = (await metaPost("/images/edits", body, MUSE_TIMEOUT_MS, opts.deadline)) as MuseResponse;
  const item = json?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) return downloadBuffer(item.url);
  throw new Error("Muse Image bir görsel döndürmedi.");
}

// ---------------------------------------------------------------- Responses

export type ResponsesJson = {
  output_text?: unknown;
  output?: { content?: { type?: string; text?: unknown }[] }[];
};

/** Responses cevabından metin çıktısını toplar. */
export function responseText(json: ResponsesJson | null): string {
  if (typeof json?.output_text === "string") return json.output_text;
  const parts: string[] = [];
  for (const item of json?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

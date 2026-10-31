import { NextResponse } from "next/server";
import { logEvent } from "@/lib/events";
import { guard } from "@/lib/guard";
import { localMediaPath, publicBaseUrl } from "@/lib/media";
import { MetaConfigError } from "@/lib/meta";
import { ResolveError, assertPublicHttpUrl } from "@/lib/resolve";
import { SLOT_LABELS, type Slot } from "@/lib/slots";
import {
  TryOnError,
  generateTryOn,
  nearestAspectRatio,
  type GarmentInput,
  type TryOnResult,
} from "@/lib/tryon";
import { refund, reserve } from "@/lib/credits";
import { awaitCard } from "@/lib/productcache";
import { cardEnabled } from "@/lib/productcard";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_GARMENTS = 4;
const CARD_WAIT_MS = 2000;

/**
 * Tarif istemciden değil, sunucunun ürün kartı önbelleğinden geliyor; böylece
 * istemciye isteme metin sokma yolu açılmıyor. Kart bulunamazsa veya süre
 * dolarsa parça tarifsiz gider; bu adım isteği asla düşürmez.
 */
async function attachCards(garments: GarmentInput[]): Promise<number> {
  if (!cardEnabled()) return 0;
  // Süre dolduktan sonra gelen kart parçaya yazılmasın diye sonuçlar önce
  // ayrı dizide toplanıyor, parçalara yalnız bekleme bitince aktarılıyor.
  const found: (string | undefined)[] = garments.map(() => undefined);
  const lookups = garments.map(async (garment, index) => {
    const card = await awaitCard(garment.image, CARD_WAIT_MS).catch(() => undefined);
    found[index] = card?.description || undefined;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CARD_WAIT_MS);
  });
  try {
    await Promise.race([Promise.allSettled(lookups), deadline]);
  } finally {
    clearTimeout(timer);
  }
  garments.forEach((garment, index) => {
    if (found[index]) garment.description = found[index];
  });
  return garments.filter((garment) => garment.description).length;
}

/**
 * Avatar bizim /api/media adresimizse ve dosya diskteyse yolunu döner.
 * Web'de avatar yalnız böyle kabul ediliyor: portal avatarı /api/avatar ile
 * buraya yüklüyor; başka adres gelirse rastgele görsel çerezle giydirilmesin.
 */
async function isOwnMediaUrl(raw: string): Promise<boolean> {
  return (await localMediaPath(raw)) !== null;
}

function parseGarments(raw: unknown): GarmentInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new TryOnError("En az bir kıyafet gerekiyor.", "no-garments");
  }
  if (raw.length > MAX_GARMENTS) {
    throw new TryOnError(`En fazla ${MAX_GARMENTS} parça giydirilebilir.`, "too-many");
  }

  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new TryOnError("Kıyafet bilgisi eksik.", "bad-garment");
    }
    const record = entry as Record<string, unknown>;
    const slot = record["slot"];
    const image = record["image"];
    const name = record["name"];

    if (typeof slot !== "string" || !(slot in SLOT_LABELS)) {
      throw new TryOnError("Geçersiz kıyafet yuvası.", "bad-garment");
    }
    if (typeof image !== "string") {
      throw new TryOnError("Kıyafet görseli eksik.", "bad-garment");
    }
    assertPublicHttpUrl(image);

    return {
      slot: slot as Slot,
      image,
      name: typeof name === "string" && name.trim() ? name.trim() : SLOT_LABELS[slot as Slot],
    };
  });
}

export async function POST(request: Request) {
  const started = Date.now();
  let device = request.headers.get("x-tryit-device") ?? "";
  let detail: string | undefined;

  let outcome: TryOnResult | undefined;
  let cardCount: number | undefined;

  const note = (ok: boolean, code?: string, extra?: string) =>
    logEvent({
      at: new Date().toISOString(),
      event: "tryon",
      device,
      ok,
      code,
      ms: Date.now() - started,
      detail: extra ?? detail,
      provider: outcome?.provider ?? "muse",
      costUsd: outcome?.costUsd,
      museMs: outcome?.stages?.museMs,
      cards: cardCount,
    });

  const verdict = guard(request, "tryon");
  if (!verdict.ok) {
    await note(false, verdict.code);
    return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: verdict.status });
  }
  device = verdict.device;
  const web = verdict.channel === "web";

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    await note(false, "bad-body");
    return NextResponse.json({ error: "Geçersiz istek.", code: "bad-body" }, { status: 400 });
  }

  try {
    const avatarUrl = body["avatarUrl"];
    if (typeof avatarUrl !== "string") {
      throw new TryOnError("Önce bir avatar oluşturun.", "no-avatar");
    }
    // Kendi medya adresimiz diskten okunuyor; ağa çıkılmadığı için SSRF
    // denetimi yalnız dış adreslere uygulanıyor (yerelde localhost da geçsin).
    const ownMedia = await isOwnMediaUrl(avatarUrl);
    if (!ownMedia) assertPublicHttpUrl(avatarUrl);
    if (web && !ownMedia) {
      await note(false, "bad-avatar");
      return NextResponse.json(
        { error: "Avatar adresi geçersiz. Fotoğrafı yeniden yükle.", code: "bad-avatar" },
        { status: 422 },
      );
    }

    const garments = parseGarments(body["garments"]);
    // Kaç parçalık kombinlerin denendiği ürünün asıl sorusu: tek parça
    // deneme mi yapıyorlar, yoksa kombin mi kuruyorlar.
    detail = `${garments.length} parça`;

    // Avatarın ölçüleri tarayıcıda okunup gönderiliyor. Gelmezse modele
    // "auto" gider, ama o zaman çıktının oranı sabit kalmayabilir.
    const width = Number(body["avatarWidth"]);
    const height = Number(body["avatarHeight"]);
    const aspectRatio =
      Number.isFinite(width) && Number.isFinite(height)
        ? nearestAspectRatio(width, height)
        : undefined;

    // Hak, para harcanmadan önce ayrılıyor; üretim başarısız olursa iade.
    // Web'de kredi yok; sınırı guard koyuyor, cevapta credits alanı olmuyor.
    const reserved = web ? undefined : await reserve(device, body["entitlement"]);
    const credits = reserved?.status;
    detail = `${detail}, ${credits ? credits.plan : "web"}`;
    if (reserved && !reserved.account) {
      await note(false, "no-credits");
      return NextResponse.json(
        { error: "Kombin hakkın kalmadı.", code: "no-credits", credits },
        { status: 402 },
      );
    }

    cardCount = await attachCards(garments);
    detail = `${detail}, kart ${cardCount}/${garments.length}`;

    let generated: TryOnResult;
    try {
      generated = await generateTryOn({ avatarUrl, garments, aspectRatio, baseUrl: publicBaseUrl(request) });
    } catch (err) {
      if (reserved?.account) {
        await refund(reserved.account).catch((e) => console.error("refund failed", e));
      }
      throw err;
    }
    outcome = generated;
    // Maliyet ve aşama süreleri yalnız günlüğe gidiyor; cevap sözleşmesi aynı kalıyor.
    const { costUsd: _cost, stages: _stages, ...result } = generated;

    await note(true);
    return NextResponse.json({ ...result, credits });
  } catch (err) {
    if (err instanceof TryOnError) {
      await note(false, err.code, err.code === "model-failed" || err.code === "content-filtered" ? (err.detail ?? err.message).slice(0, 200) : detail);
      // Kod uygulamaya da gidiyor: avatar adresi bayatlamışsa uygulama
      // yalnızca bu durumda yeniden yükleyip tekrar deniyor.
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    if (err instanceof ResolveError) {
      await note(false, err.code);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    if (err instanceof MetaConfigError) {
      await note(false, "no-key-configured");
      return NextResponse.json({ error: err.message, code: "server-config" }, { status: 500 });
    }
    await note(false, "crash", String(err instanceof Error ? err.message : err).slice(0, 200));
    console.error("tryon failed", err);
    return NextResponse.json({ error: "Kombin oluşturulamadı.", code: "crash" }, { status: 500 });
  }
}

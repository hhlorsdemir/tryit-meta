import { after, NextResponse } from "next/server";
import { logEvent, type TryItEvent } from "@/lib/events";
import { guard } from "@/lib/guard";
import { buildProductCard, cardEnabled, type ProductCard } from "@/lib/productcard";
import { getCard, pendingCard, putCard, trackPending } from "@/lib/productcache";
import { ResolveError, SparkNotProductError, resolveProductWithPage, type ResolvedProduct } from "@/lib/resolve";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Cevabın en geç dönmesi gereken an; maxDuration 30 sn, pay bırakılıyor. */
const RESPONSE_BUDGET_MS = 25_000;
/** after() içinde süren kartın son anı; maxDuration içinde kalsın. */
const CARD_BUDGET_MS = 28_000;

type CardOutcome =
  | { code: "disabled" }
  | { code: "ok"; card: ProductCard; hit: boolean }
  | { code: "pending" }
  | { code: "error"; message: string };

function cardWaitMs(started: number): number {
  const configured = Number(process.env.PRODUCT_CARD_WAIT_MS ?? 8000);
  const wait = Number.isFinite(configured) && configured >= 0 ? configured : 8000;
  return Math.max(0, Math.min(wait, RESPONSE_BUDGET_MS - (Date.now() - started)));
}

/** Promise'i süre dolunca reddeder; gövdesi takılan istek pending kaydını ve after()'ı sonsuza kadar tutmasın. */
function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Kart süre bütçesi doldu.")), Math.max(0, ms));
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

type CardStart = { card: Promise<ProductCard>; hit: boolean };

/** Önbellekte veya üretimde olan kartı kullanır; yoksa yenisini başlatır. Her resolve para harcamasın. */
async function startCard(product: ResolvedProduct, html: string, started: number): Promise<CardStart> {
  const key = product.images[0];
  const cached = key ? await getCard(key) : undefined;
  if (cached) return { card: Promise.resolve(cached), hit: true };
  const pending = key ? pendingCard(key) : undefined;
  if (pending) {
    const card = pending.then((c) => {
      if (!c) throw new Error("Bekleyen kart üretilemedi.");
      return c;
    });
    return { card, hit: true };
  }
  return { card: buildAndStore(product, html, started), hit: false };
}

/**
 * Kartı üretir, bitince önbelleğe yazar ve bekleyenlere bağlar.
 * Önbellek yazımı kartın parçası: tryon bekleyen kartı alınca diskte de bulsun.
 */
function buildAndStore(product: ResolvedProduct, html: string, started: number): Promise<ProductCard> {
  const built = buildProductCard({
    name: product.name,
    slotHint: product.slot,
    pageText: html,
    images: product.images.slice(0, 4),
    deadline: started + CARD_BUDGET_MS,
  }).then(async (c) => {
    await putCard(product.images, c);
    return c;
  });
  const card = withBudget(built, CARD_BUDGET_MS - (Date.now() - started));
  trackPending(product.images, card);
  return card;
}

/** Kartı süresi kadar bekler; geç kalırsa after() içinde tamamlanmasını ister. */
async function waitCard({ card, hit }: CardStart, waitMs: number): Promise<CardOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs);
  });
  try {
    const result = await Promise.race([card, late]);
    if (result !== "late") return { code: "ok", card: result, hit };
  } catch (err) {
    return { code: "error", message: String(err instanceof Error ? err.message : err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
  after(async () => {
    try {
      await card;
    } catch (err) {
      console.warn(`[resolve] geç kart başarısız: ${err instanceof Error ? err.message : err}`);
    }
  });
  return { code: "pending" };
}

function cardLogOf(outcome: CardOutcome): Partial<TryItEvent> {
  if (outcome.code !== "ok") return { cardCode: outcome.code };
  // İsabette Spark çağrılmadı: süre ve maliyet bu isteğe yazılmaz.
  if (outcome.hit) return { cardCode: "hit" };
  return { cardCode: "ok", cardMs: outcome.card.ms, cardCostUsd: outcome.card.costUsd };
}

function sparkLogOf(spark?: { ms: number; costUsd: number }): Partial<TryItEvent> {
  return spark ? { sparkMs: spark.ms, sparkCostUsd: spark.costUsd } : {};
}

/** Günlükte yalnızca alan adı duruyor, tam link değil. */
function hostOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  let device = request.headers.get("x-tryit-device") ?? "";
  let host: string | undefined;

  const note = (ok: boolean, code?: string, detail?: string, extra: Partial<TryItEvent> = {}) =>
    logEvent({
      at: new Date().toISOString(),
      event: "resolve",
      device,
      ok,
      code,
      ms: Date.now() - started,
      host,
      detail,
      ...extra,
    });

  const verdict = guard(request, "resolve");
  if (!verdict.ok) {
    await note(false, verdict.code);
    return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: verdict.status });
  }
  device = verdict.device;

  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    await note(false, "bad-body");
    return NextResponse.json({ error: "Geçersiz istek.", code: "bad-body" }, { status: 400 });
  }

  if (typeof url !== "string" || !url.trim()) {
    await note(false, "no-url");
    return NextResponse.json({ error: "Bir ürün linki gerekiyor.", code: "no-url" }, { status: 400 });
  }
  host = hostOf(url);

  try {
    const { product, html, spark } = await resolveProductWithPage(url, { deadline: started + RESPONSE_BUDGET_MS });
    const sourceLog: Partial<TryItEvent> = { resolveSource: product.source, ...sparkLogOf(spark) };
    const outcome: CardOutcome = cardEnabled()
      ? await waitCard(await startCard(product, html, started), cardWaitMs(started))
      : { code: "disabled" };
    let cardLog = cardLogOf(outcome);

    if (outcome.code === "ok") {
      if (!outcome.card.isGarment && !product.slotConfident) {
        await note(false, "not-product", `${product.source} card:not-garment`, { ...sourceLog, ...cardLog, cardCode: "not-garment" });
        return NextResponse.json(
          { error: "Bu bir kıyafet veya ayakkabı değil gibi görünüyor.", code: "not-product" },
          { status: 422 },
        );
      }
      if (!outcome.card.isGarment) {
        // Kelime kuralı emin: kartın reddi yanlış olabilir, ürün geçer ama karttan bir şey alınmaz.
        cardLog = { ...cardLog, cardCode: "not-garment-ignored" };
      } else {
        // Kart yalnız kelime kuralı emin değilken yuvayı belirler; emin kural kalır, tarif eklenir.
        if (!product.slotConfident) {
          product.slot = outcome.card.slot;
          product.slotConfident = true;
        }
        if (outcome.card.description) product.description = outcome.card.description;
      }
    }

    // Yuva ve ne kadar emin olundugu raporda duruyor: yanlis siniflanan
    // urun kombinde baska bir parcanin yerine geciyor ve kullanici
    // parcasini kaybediyor. Hangi urunlerde tahmine dustugumuzu
    // gormeden bu duzelmez.
    const cardPart = outcome.code === "error" ? `card:error ${outcome.message}` : `card:${cardLog.cardCode}`;
    await note(
      true,
      undefined,
      `${product.slot}${product.slotConfident ? "" : "?"} ${product.rendered ? "rendered" : "plain"} ${product.source} ${cardPart}`,
      { ...sourceLog, ...cardLog },
    );
    return NextResponse.json(product);
  } catch (err) {
    if (err instanceof ResolveError) {
      const extra = err instanceof SparkNotProductError ? { resolveSource: "spark", ...sparkLogOf(err.spark) } : {};
      await note(false, err.code, err instanceof SparkNotProductError ? "spark" : undefined, extra);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    await note(false, "crash", String(err instanceof Error ? err.message : err).slice(0, 200));
    console.error("resolve failed", err);
    return NextResponse.json({ error: "Link çözülemedi.", code: "crash" }, { status: 500 });
  }
}

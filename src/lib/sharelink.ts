/**
 * Mağaza uygulamalarının paylaş menüsü çoğu zaman ürün sayfasını değil kısa
 * bir link veriyor. Trendyol: `ty.gl/...` önce Adjust takip linkine
 * (`*.adj.st`) yönlendiriyor; asıl ürün adresi o linkin `adjust_redirect`
 * parametresinde duruyor. Takip sayfasının kendisinde ürün verisi yok (kapak
 * görseli bile kampanya görseli), çözücü oraya takılınca "no-data" dönüyordu.
 *
 * Bu modül bağımlılıksız; birim testinde doğrudan yüklenebiliyor.
 */

/** Yönlendirmesi sunucuda HTTP ile açılan kısa link alanları. */
const SHORT_HOSTS = ["ty.gl"];

/** Takip linklerinde asıl adresi taşıyan parametreler. */
const TARGET_PARAMS = ["adjust_redirect"];

/** Ürün adresinden atılan takip parametreleri; varyant ve satıcı kalır. */
const TRACKING_PARAM = /^(utm_|adjust_|adj_)|^(timestamp|link_contentid)$/i;

const MAX_STEPS = 4;
const STEP_TIMEOUT_MS = 8_000;

function isShortHost(host: string): boolean {
  const h = host.toLowerCase();
  return SHORT_HOSTS.includes(h) || h.endsWith(".adj.st");
}

/** Linkin içinde gömülü asıl adres varsa onu döner. */
export function embeddedTarget(url: URL): URL | null {
  for (const name of TARGET_PARAMS) {
    const raw = url.searchParams.get(name);
    if (!raw) continue;
    try {
      const target = new URL(raw);
      if (target.protocol === "http:" || target.protocol === "https:") return target;
    } catch {
      // Bozuk parametre: yok say.
    }
  }
  return null;
}

/** Takip parametrelerini atar; kalan sorgu (boutiqueId, merchantId, renk) aynı. */
export function stripTracking(url: URL): URL {
  const clean = new URL(url);
  for (const name of [...clean.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) clean.searchParams.delete(name);
  }
  return clean;
}

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;

/**
 * Kısa ve takip linklerini asıl ürün adresine açar. Her adımda yeni adres
 * `validate` ile denetlenir (SSRF); açılamazsa eldeki son adres döner ve
 * çözücü eskisi gibi devam eder.
 */
export async function unwrapShareLink(
  url: URL,
  validate: (raw: string) => URL,
  fetcher: Fetcher = (u, init) => fetch(u, init),
): Promise<URL> {
  let current = url;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const embedded = embeddedTarget(current);
    if (embedded) {
      current = validate(embedded.toString());
      continue;
    }
    if (!isShortHost(current.hostname)) break;

    let location: string | null = null;
    try {
      const res = await fetcher(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      await res.body?.cancel();
    } catch {
      break;
    }
    if (!location) break;
    current = validate(new URL(location, current).toString());
  }
  return stripTracking(current);
}

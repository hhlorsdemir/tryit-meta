/**
 * Bot korumalı sayfalar için gerçek tarayıcı katmanı.
 *
 * Trendyol düz isteği 403 ile kapatıyor, Zara ise Akamai'nin doğrulama
 * sayfasını döndürüyor; ikisinde de istediğimiz JSON-LD sunucudan hiç
 * gelmiyor. Düz fetch yetmediğinde sayfayı başsız Chromium'da açıp
 * oluşmuş HTML'i okuyoruz.
 *
 * Tarayıcı pahalı bir kaynak: bir kez açılıp açık tutuluyor, her istek
 * kendi bağlamını alıp kapatıyor. Böylece çerezler istekler arasında
 * taşınmıyor ama başlatma maliyeti bir kereye kalıyor.
 */

import type { Browser } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NAVIGATION_TIMEOUT = 30_000;
/**
 * Ürün verisinin sayfaya düşmesi için beklenen süre.
 *
 * Ürün sayfalarında bir saniyenin altında doluyor; bu süre asıl olarak
 * ürün olmayan sayfalarda ne kadar bekleyeceğimizi belirliyor.
 */
const CONTENT_TIMEOUT = 7_000;

/**
 * Ülkeye göre yönlendiren siteler için mağaza çerezleri.
 *
 * Sunucu Türkiye dışında (Hetzner, Finlandiya). Trendyol IP'ye bakıp
 * uluslararası `/en` mağazasına yönlendiriyor; Türkiye ürün sayfaları orada
 * olmadığı için sayfa 404 dönüyor. Çerezle mağazayı sabitleyince Türkçe
 * sayfa geliyor. Zara'da böyle bir sorun yok, ülke zaten adresin içinde.
 */
const STOREFRONT_COOKIES: Array<{ host: RegExp; values: Record<string, string> }> = [
  {
    host: /(^|\.)trendyol\.com$/i,
    values: { storefrontId: "1", countryCode: "TR", language: "tr" },
  },
];

function storefrontCookiesFor(url: URL) {
  const match = STOREFRONT_COOKIES.find((entry) => entry.host.test(url.hostname));
  if (!match) return [];

  // Alt alan adlarının da kapsanması için nokta ile başlayan alan adı.
  const parts = url.hostname.split(".");
  const domain = parts.length > 2 ? `.${parts.slice(-2).join(".")}` : `.${url.hostname}`;

  return Object.entries(match.values).map(([name, value]) => ({
    name,
    value,
    domain,
    path: "/",
  }));
}

export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserError";
  }
}

/**
 * Açık tarayıcı. Geliştirme sunucusu modülleri yeniden yüklediği için
 * globalThis üzerinde tutuluyor, yoksa her değişiklikte yeni bir Chromium
 * açılıp eskisi kaçak kalıyor.
 */
const store = globalThis as typeof globalThis & {
  __tryitBrowser?: Promise<Browser>;
};

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    // Zara'nın bot koruması başsız Chromium'u tanıyor ve 403 veriyor; üç
    // başsız kipin üçü de kapıdan dönüyor, başlıklı tarayıcı geçiyor.
    // Pencereyi açmak zorundayız ama ekranın dışına alıyoruz.
    headless: false,
    args: [
      // navigator.webdriver bayrağı en yaygın bot işaretlerinden biri.
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--window-position=-3000,-3000",
      "--window-size=1440,900",
    ],
  });
  browser.on("disconnected", () => {
    store.__tryitBrowser = undefined;
  });
  return browser;
}

async function shared(): Promise<Browser> {
  const existing = store.__tryitBrowser;
  if (existing) {
    try {
      const browser = await existing;
      if (browser.isConnected()) return browser;
    } catch {
      // Önceki açılış başarısızsa aşağıda yeniden deniyoruz.
    }
  }

  const next = launch();
  store.__tryitBrowser = next;
  try {
    return await next;
  } catch (err) {
    store.__tryitBrowser = undefined;
    throw new BrowserError(
      err instanceof Error && /Executable doesn't exist/i.test(err.message)
        ? "Tarayıcı kurulu değil. `npx playwright install chromium` çalıştırın."
        : "Tarayıcı açılamadı.",
    );
  }
}

/** Sayfayı tarayıcıda açıp oluşmuş HTML'i döndürür. */
export async function fetchRendered(url: URL, timeoutMs?: number): Promise<string> {
  // Çağıran bütçe verirse hiçbir bekleme ondan uzun sürmesin.
  const cap = (ms: number) => (timeoutMs === undefined ? ms : Math.max(1, Math.min(ms, timeoutMs)));
  const browser = await shared();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  try {
    const cookies = storefrontCookiesFor(url);
    if (cookies.length) await context.addCookies(cookies);

    const page = await context.newPage();

    // Görsel, yazı tipi ve izleme istekleri sayfanın HTML'ini değiştirmiyor
    // ama süreyi kat kat uzatıyor.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });

    // "commit" ilk yanıt gelir gelmez dönüyor; sayfanın bütün betiklerini
    // beklemek yerine aradığımız veriyi bekliyoruz. Trendyol'da 20 saniye
    // olan süre bu ikisiyle bir saniyenin altına iniyor.
    await page.goto(url.toString(), {
      waitUntil: "commit",
      timeout: cap(NAVIGATION_TIMEOUT),
    });

    // Bot doğrulama sayfaları kendilerini yenileyip asıl sayfaya geçiyor;
    // ürün JSON-LD'si göründüğünde oradayız demektir. Script öğeleri hiçbir
    // zaman görünür olmadığı için "attached" şart: varsayılan görünürlük
    // beklentisi her seferinde zaman aşımına kadar bekletiyordu.
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((node) =>
            /"@type"\s*:\s*"(Product|ProductGroup)"/.test(node.textContent ?? ""),
          ),
        undefined,
        { timeout: cap(CONTENT_TIMEOUT) },
      )
      .catch(() =>
        page
          .waitForSelector('script[type="application/ld+json"]', {
            state: "attached",
            timeout: cap(2_000),
          })
          .catch(() => undefined),
      );

    return await page.content();
  } catch (err) {
    if (err instanceof BrowserError) throw err;
    throw new BrowserError(
      err instanceof Error && /Timeout/i.test(err.message)
        ? "Sayfa tarayıcıda da açılamadı, zaman aşımına uğradı."
        : "Sayfa tarayıcıda açılamadı.",
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

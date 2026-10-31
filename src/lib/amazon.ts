// Amazon ürün sayfası okuyucusu. Amazon JSON-LD ve OpenGraph yayınlamıyor;
// sayfadaki sabit kimlikli bloklardan okuyoruz. Sayfa 1 MB'ı aşabildiği için
// önce indexOf ile blok bulunuyor, regex yalnız sınırlı kesitte çalışıyor.

export type AmazonProduct = {
  url: string;
  name: string;
  brand?: string;
  price?: string;
  currency?: string;
  images: string[];
  categoryPath?: string[];
};

const CURRENCY_BY_DOMAIN: Record<string, string> = {
  "amazon.com": "USD",
  "amazon.com.tr": "TRY",
  "amazon.de": "EUR",
  "amazon.fr": "EUR",
  "amazon.it": "EUR",
  "amazon.es": "EUR",
  "amazon.nl": "EUR",
  "amazon.com.be": "EUR",
  "amazon.co.uk": "GBP",
  "amazon.ca": "CAD",
  "amazon.com.au": "AUD",
  "amazon.co.jp": "JPY",
  "amazon.in": "INR",
  "amazon.com.mx": "MXN",
  "amazon.com.br": "BRL",
  "amazon.se": "SEK",
  "amazon.pl": "PLN",
  "amazon.ae": "AED",
  "amazon.sa": "SAR",
  "amazon.sg": "SGD",
};

function baseDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|m|smile)\./, "");
}

export function isAmazonHost(hostname: string): boolean {
  return baseDomain(hostname) in CURRENCY_BY_DOMAIN;
}

export function canonicalAmazonUrl(url: URL): URL {
  const match = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?#]|$)/.exec(url.pathname);
  if (!match) return url;
  return new URL(`https://${url.hostname}/dp/${match[1]}`);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function cleanText(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** `marker` geçen ilk yerden başlayıp en çok `limit` karakterlik kesit. */
function section(html: string, marker: string, limit: number, from = 0): string | null {
  const start = html.indexOf(marker, from);
  return start < 0 ? null : html.slice(start, start + limit);
}

function readTitle(html: string): string | null {
  // İlk eşleşme bazen kendini kapatan boş bir etiket; içi dolu olanı arıyoruz.
  let from = 0;
  for (;;) {
    const at = html.indexOf(' id="productTitle"', from);
    if (at < 0) return null;
    const open = html.indexOf(">", at);
    if (open < 0) return null;
    from = open;
    if (html[open - 1] === "/") continue;
    const close = html.indexOf("<", open);
    if (close < 0) return null;
    const title = cleanText(html.slice(open + 1, Math.min(close, open + 2000)));
    if (title) return title;
  }
}

function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isAmazonImage(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      (isUnder(u.hostname, "media-amazon.com") || isUnder(u.hostname, "images-amazon.com"))
    );
  } catch {
    return false;
  }
}

/** `parseJSON('` sonrasındaki tek tırnaklı JS dizesini kaçışları çözülmüş verir. */
function readQuotedLiteral(html: string, start: number, limit: number): string | null {
  const end = Math.min(html.length, start + limit);
  for (let i = start; i < end; i++) {
    const ch = html[i];
    if (ch === "\\") i++;
    else if (ch === "'") return html.slice(start, i).replace(/\\([\\'])/g, "$1");
  }
  return null;
}

function readColorImages(html: string): string[] {
  const block = html.indexOf("'colorImages'");
  if (block < 0) return [];
  const opener = "parseJSON('";
  const at = html.indexOf(opener, block);
  if (at < 0 || at - block > 300) return [];
  const literal = readQuotedLiteral(html, at + opener.length, 500_000);
  if (!literal) return [];
  try {
    const items: unknown = JSON.parse(literal);
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      return entry["hiRes"] ?? entry["large"];
    }).filter(isAmazonImage);
  } catch {
    return [];
  }
}

function readDynamicImage(html: string): string[] {
  const id = html.indexOf(' id="landingImage"');
  if (id < 0) return [];
  const tagStart = html.lastIndexOf("<img", id);
  const tag = html.slice(tagStart < 0 || id - tagStart > 5000 ? id : tagStart, id + 8000);
  const marker = 'data-a-dynamic-image="';
  const at = tag.indexOf(marker);
  if (at < 0) return [];
  const end = tag.indexOf('"', at + marker.length);
  if (end < 0) return [];
  try {
    const sizes = JSON.parse(decodeEntities(tag.slice(at + marker.length, end))) as Record<string, unknown>;
    const area = (v: unknown) => (Array.isArray(v) ? Number(v[0]) * Number(v[1]) || 0 : 0);
    return Object.entries(sizes)
      .sort((a, b) => area(b[1]) - area(a[1]))
      .map(([src]) => src)
      .filter(isAmazonImage);
  } catch {
    return [];
  }
}

function readImages(html: string): string[] {
  const primary = readColorImages(html);
  return [...new Set(primary.length ? primary : readDynamicImage(html))];
}

function readCategoryPath(html: string): string[] | undefined {
  const block = section(html, ' id="wayfinding-breadcrumbs_feature_div"', 10_000);
  if (!block) return undefined;
  const ul = block.indexOf("</ul>");
  const list = ul > 0 ? block.slice(0, ul) : block;
  const names = [...list.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)].map((m) => cleanText(m[1])).filter(Boolean);
  return names.length ? names : undefined;
}

function readPrice(html: string): string | undefined {
  // Sponsorlu kartlar da a-price-whole taşıyor; yalnız ana fiyat bloğuna bakıyoruz.
  const block = section(html, ' id="corePrice', 12_000);
  if (!block) return undefined;
  const wholeMarker = 'class="a-price-whole">';
  const at = block.indexOf(wholeMarker);
  if (at < 0) return undefined;
  const whole = block.slice(at + wholeMarker.length, at + wholeMarker.length + 40).split("<")[0].replace(/\D/g, "");
  if (!whole) return undefined;
  const fractionMarker = 'class="a-price-fraction">';
  const f = block.indexOf(fractionMarker, at);
  const fraction =
    f >= 0 && f - at < 300 ? block.slice(f + fractionMarker.length, f + fractionMarker.length + 10).split("<")[0].replace(/\D/g, "") : "";
  return fraction && !/^0+$/.test(fraction) ? `${whole}.${fraction}` : whole;
}

const BRAND_PATTERNS = [
  /^(?:Marka|Brand|Marke|Marque|Marca|Merk)\s*:\s*(.+)$/i,
  /^Visit the (.+) Store$/i,
  /^(.+) Store['’]u ziyaret edin$/i,
  /^Besuchen Sie den (.+)-Store$/i,
  /^Visitez la boutique (.+)$/i,
];

function readBrand(html: string): string | undefined {
  const block = section(html, ' id="bylineInfo"', 3000);
  if (!block) return undefined;
  const open = block.indexOf(">");
  const close = block.indexOf("<", open);
  if (open < 0 || close < 0) return undefined;
  const text = cleanText(block.slice(open + 1, close));
  for (const pattern of BRAND_PATTERNS) {
    const brand = pattern.exec(text)?.[1]?.trim();
    if (brand) return brand;
  }
  return undefined;
}

export function readAmazon(html: string, url: URL): AmazonProduct | null {
  const name = readTitle(html);
  if (!name) return null;
  const images = readImages(html);
  if (!images.length) return null;

  const price = readPrice(html);
  return {
    url: canonicalAmazonUrl(url).toString(),
    name,
    brand: readBrand(html),
    price,
    currency: price ? CURRENCY_BY_DOMAIN[baseDomain(url.hostname)] : undefined,
    images,
    categoryPath: readCategoryPath(html),
  };
}

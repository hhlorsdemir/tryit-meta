/**
 * JSON-LD ve OpenGraph'ı olmayan ürün sayfalarında görsel aday listesi.
 * Model adres uydurmasın diye adayları biz çıkarıyoruz; model yalnız indeks seçer.
 *
 * Bu modül bağımlılıksız; birim testinde doğrudan yüklenebiliyor.
 * 5 MB HTML gelebilir: etiketler tek geçişte sınırlı bir desenle taranır,
 * uzak eşleştirme yok.
 */

export type ImageCandidate = {
  url: string;
  score: number;
  width?: number;
  height?: number;
  alt?: string;
};

type Raw = {
  raw: string;
  width?: number;
  height?: number;
  alt?: string;
  cls?: string;
  bonus: number;
};

// Dev sayfalarda düzenli ifade süresi sınırlı kalsın.
const MAX_SCAN_CHARS = 1_000_000;
const TAG = /<(img|source|a|meta)\b[^>]{0,2000}>/gi;

const IMG_ATTRS = [
  "src",
  "data-src",
  "data-lazy-src",
  "data-original",
  "data-old-hires",
  "data-zoom-image",
  "data-large_image",
];
const HIRES_ATTRS = new Set(["data-old-hires", "data-zoom-image"]);
const HIRES_BONUS = 2000;
const ALT_BONUS = 50;

const META_KEYS = new Set([
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "twitter:image",
  "twitter:image:src",
]);

const JUNK =
  /logo|icon|sprite|favicon|badge|flag|payment|loader|spinner|placeholder|pixel|tracking|banner|avatar/i;
const BAD_EXT = /\.(svg|gif)$/i;
const LINK_EXT = /\.(jpe?g|png|webp)$/i;
const ALT_HINT = /ürün|urun|product|gallery|galeri/i;
const SIZE_PARAMS = new Set(["w", "width", "h", "height", "wid", "hei", "size", "resize"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Etiket metnindeki öznitelikleri okur; adlar küçük harfe çevrilir. */
function parseAttrs(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const n = tag.length;
  let i = tag.match(/^<[a-z]+/i)?.[0].length ?? n;
  while (i < n) {
    while (i < n && /[\s/>]/.test(tag[i])) i++;
    const start = i;
    while (i < n && !/[\s=/>]/.test(tag[i])) i++;
    if (i === start) break;
    const name = tag.slice(start, i).toLowerCase();
    while (i < n && /\s/.test(tag[i])) i++;
    let value = "";
    if (tag[i] === "=") {
      i++;
      while (i < n && /\s/.test(tag[i])) i++;
      const q = tag[i];
      if (q === '"' || q === "'") {
        const end = tag.indexOf(q, i + 1);
        const stop = end < 0 ? n : end;
        value = tag.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const vs = i;
        while (i < n && !/[\s>]/.test(tag[i])) i++;
        value = tag.slice(vs, i);
      }
    }
    if (!out.has(name)) out.set(name, decodeEntities(value.trim()));
  }
  return out;
}

function toInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** srcset içinden en büyük `w` (yoksa en büyük `x`) adayını seçer. */
export function pickFromSrcset(srcset: string): { url: string; width?: number } | null {
  const tokens = srcset.trim().split(/\s+/);
  let best: { url: string; width?: number; rank: number } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const url = tokens[i].replace(/,$/, "");
    if (!url) continue;
    let width: number | undefined;
    let rank = 0;
    const d = tokens[i + 1]?.match(/^(\d+(?:\.\d+)?)([wx]),?$/i);
    if (d && !tokens[i].endsWith(",")) {
      i++;
      const v = parseFloat(d[1]);
      if (d[2].toLowerCase() === "w") {
        width = Math.round(v);
        rank = v * 10;
      } else rank = v;
    }
    if (!best || rank >= best.rank) best = { url, width, rank };
  }
  return best ? { url: best.url, width: best.width } : null;
}

/** URL'deki boyut ipuçlarından tahmini genişlik. */
function urlSizeHint(url: string): number {
  let hint = 0;
  const amz = url.match(/_(?:AC_)?(?:SL|SX|SY|UX|UY|US|SS)(\d{2,4})_/i);
  if (amz) hint = Math.max(hint, +amz[1]);
  const dim = url.match(/(?:^|[^\d])(\d{3,4})x(\d{3,4})(?:[^\d]|$)/);
  if (dim) hint = Math.max(hint, +dim[1], +dim[2]);
  const q = url.match(/[?&](?:w|width|wid)=(\d{2,4})\b/i);
  if (q) hint = Math.max(hint, +q[1]);
  if (/\/(large|zoom|original)\//i.test(url) || /hires/i.test(url)) hint = Math.max(hint, 1000);
  return hint;
}

/** Tekrar kontrolü için boyut parametreleri ve Amazon boyut eki atılmış anahtar. */
function dedupeKey(u: URL): string {
  const k = new URL(u.href);
  k.hash = "";
  for (const name of [...k.searchParams.keys()]) {
    if (SIZE_PARAMS.has(name.toLowerCase())) k.searchParams.delete(name);
  }
  k.pathname = k.pathname.replace(/\._[A-Z0-9_,]+_(?=\.[a-z]+$)/i, "");
  return k.href;
}

function resolve(raw: string, base: URL): URL | null {
  const s = raw.trim();
  if (!s || /^(data|blob):/i.test(s)) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function isJunk(r: Raw, u: URL): boolean {
  if (BAD_EXT.test(u.pathname)) return true;
  if (JUNK.test(u.href) || JUNK.test(r.alt ?? "") || JUNK.test(r.cls ?? "")) return true;
  if (r.width === 1 && r.height === 1) return true;
  if (r.width !== undefined && r.height !== undefined && r.width < 200 && r.height < 200) return true;
  return /(^|[^\d])1x1([^\d]|$)/.test(u.pathname);
}

function fromImg(a: Map<string, string>): Raw[] {
  const base = {
    width: toInt(a.get("width")),
    height: toInt(a.get("height")),
    alt: a.get("alt") || undefined,
    cls: a.get("class"),
  };
  const out: Raw[] = [];
  for (const name of IMG_ATTRS) {
    const v = a.get(name);
    if (v) out.push({ ...base, raw: v, bonus: HIRES_ATTRS.has(name) ? HIRES_BONUS : 0 });
  }
  for (const name of ["srcset", "data-srcset"]) {
    const pick = a.get(name) ? pickFromSrcset(a.get(name)!) : null;
    if (pick) out.push({ ...base, raw: pick.url, width: pick.width ?? base.width, bonus: 0 });
  }
  return out;
}

function fromTag(kind: string, a: Map<string, string>): Raw[] {
  if (kind === "img") return fromImg(a);
  if (kind === "source") {
    const pick = pickFromSrcset(a.get("srcset") ?? a.get("data-srcset") ?? "");
    return pick ? [{ raw: pick.url, width: pick.width, bonus: 0 }] : [];
  }
  if (kind === "a") {
    const href = a.get("href") ?? "";
    return LINK_EXT.test(href.split(/[?#]/)[0]) ? [{ raw: href, cls: a.get("class"), bonus: 0 }] : [];
  }
  const key = (a.get("property") ?? a.get("name") ?? "").toLowerCase();
  const content = a.get("content");
  return META_KEYS.has(key) && content ? [{ raw: content, bonus: 0 }] : [];
}

function scoreOf(r: Raw, url: string): number {
  let s = r.width ?? urlSizeHint(url);
  s += r.bonus;
  if (r.alt && ALT_HINT.test(r.alt)) s += ALT_BONUS;
  return s;
}

export function collectImageCandidates(html: string, base: URL, max = 12): ImageCandidate[] {
  html = html.slice(0, MAX_SCAN_CHARS);
  const byKey = new Map<string, ImageCandidate & { order: number }>();
  let order = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    const kind = m[1].toLowerCase();
    for (const r of fromTag(kind, parseAttrs(m[0]))) {
      const u = resolve(r.raw, base);
      if (!u || isJunk(r, u)) continue;
      const cand = { url: u.href, score: scoreOf(r, u.href), width: r.width, height: r.height, alt: r.alt };
      const key = dedupeKey(u);
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { ...cand, order: order++ });
      else if (cand.score > prev.score) byKey.set(key, { ...cand, order: prev.order });
    }
  }
  return [...byKey.values()]
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, max)
    .map(({ order: _o, ...c }) => {
      for (const k of ["width", "height", "alt"] as const) if (c[k] === undefined) delete c[k];
      return c;
    });
}

const CARD_MARK = /product-card|product-item|productcard|\bplp\b|listing|search-result/gi;
const PRICE = /(?:[$€£₺]\s?\d[\d.,]*\d)|(?:\d[\d.,]{0,15}[.,]\d{2}\s?(?:TL|₺|€|\$|£|USD|EUR))/g;

/** Liste/arama sayfası ipucu; karar çağıranda. */
export function isLikelyListingPage(html: string): boolean {
  html = html.slice(0, MAX_SCAN_CHARS);
  return countUpTo(html, CARD_MARK, 21) > 20 || countUpTo(html, PRICE, 31) > 30;
}

function countUpTo(s: string, re: RegExp, limit: number): number {
  re.lastIndex = 0;
  let n = 0;
  while (n < limit && re.exec(s)) n++;
  return n;
}

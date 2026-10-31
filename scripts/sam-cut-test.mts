// H-004a deneyi: SAM 3.1 ile ürün fotoğrafından yalnız istenen parçayı kesip
// Muse Image'a vermek manken kıyafet sızmasını azaltıyor mu (A orijinal, B kesim).
// Kullanım:
//   node --experimental-strip-types --no-warnings scripts/sam-cut-test.mts            (SAM + Muse)
//   node --experimental-strip-types --no-warnings scripts/sam-cut-test.mts --sam-only (yalnız kesimler)
//   node --experimental-strip-types --no-warnings scripts/sam-cut-test.mts --muse <klasör> (var olan kesimlerle Muse)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire, register } from "node:module";

// src/lib uzantısız göreli import kullanıyor ("./meta"); Node ESM için .ts ekleyen kanca.
const RESOLVE_HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + ".ts", context);
    }
    throw err;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(RESOLVE_HOOK)}`);

const ROOT = "/Users/hlorsdemir/Desktop/TryIt";
const sharp = createRequire(`${ROOT}/package.json`)("sharp");
for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const meta = await import(`${ROOT}/src/lib/meta.ts`);
const { buildPrompt } = await import(`${ROOT}/src/lib/tryon.ts`);

type Img = { buffer: Buffer; width: number; height: number };

// ---------------------------------------------------------------- SAM 3.1 (deneyden sonra src/lib'ten çıkarıldı)

const SAM_MODEL = "sam-3.1";
const SAM_COST_USD = 0.0025;
const SAM_TIMEOUT_MS = 30_000;
const SAM_PHRASES: Record<string, string[]> = {
  top: ["shirt", "top", "jacket", "sweater"],
  bottom: ["trousers", "pants", "shorts", "skirt"],
  shoes: ["shoes", "sneakers", "boots"],
  full: ["dress", "outfit", "clothing"],
};

type SamBox = { left: number; top: number; right: number; bottom: number; frameW: number; frameH: number };
type SamMask = { height: number; width: number; payload: string };
type SamRecord = { box: SamBox; mask: SamMask };

/** Görseli okur, EXIF yönünü uygular, uzun kenarı maxSide'a indirir ve JPEG'e çevirir. */
async function fitForMuse(buffer: Buffer, maxSide = 1536): Promise<Img> {
  const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

function samBody(phrase: string, image: ImageInput) {
  return {
    model: SAM_MODEL,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: phrase },
          { type: "input_image", image_url: `data:image/jpeg;base64,${image.buffer.toString("base64")}` },
        ],
      },
    ],
    stream: false,
    metadata: { mask_encoding: "one_bit" },
  };
}

/** Görselde ifadeye uyan bölgeleri döndürür; eşleşme yoksa boş dizi. Süreyi çağıran ölçer. */
async function samSegment(opts: {
  phrase: string;
  image: ImageInput;
  timeoutMs?: number;
  deadline?: number;
}): Promise<SamRecord[]> {
  const body = samBody(opts.phrase, opts.image);
  const json = await meta.metaPost("/responses", body, opts.timeoutMs ?? SAM_TIMEOUT_MS, opts.deadline);
  return parseSamLine(meta.responseText(json));
}

// ---------------------------------------------------------------- SAM satırı ve maske çözümü

/**
 * SAM satırı: `<0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;x=0;y=0;data=H,W,!payload|>,1<|box...`
 * Kutu köşeleri kaynak pikselde ve x2/y2 dahil; maske raster'ı kutunun içine oturuyor.
 */
function parseSamLine(text: string): SamRecord[] {
  const records: SamRecord[] = [];
  const pattern = /<\|box;([^|]*)\|><\|mask;([^|]*)\|>/g;
  for (const match of text.matchAll(pattern)) {
    const box = fields(match[1]);
    const mask = fields(match[2]);
    const [h, w, payload] = splitData(mask.data ?? "");
    records.push({
      box: {
        left: Number(box.x1), top: Number(box.y1), right: Number(box.x2) + 1, bottom: Number(box.y2) + 1,
        frameW: Number(box.w), frameH: Number(box.h),
      },
      mask: { height: h, width: w, payload },
    });
  }
  return records;
}

function fields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function splitData(data: string): [number, number, string] {
  const first = data.indexOf(",");
  const second = data.indexOf(",", first + 1);
  return [Number(data.slice(0, first)), Number(data.slice(first + 1, second)), data.slice(second + 1)];
}

// Aşağıdaki çözücü @meta-sam/parser 0.1.0 içindeki one_bit biçiminin
// (base85 paket + uyarlamalı aralık kodlayıcı + 12 komşulu bağlam) yeniden
// yazımı. Paketi bağımlılık olarak eklememek için burada.

const B85 = (() => {
  const excluded = new Set(['"', "\\", ",", ";", "<", ">", "|"]);
  const values = new Int16Array(128).fill(-1);
  let index = 0;
  for (let code = 0x21; code <= 0x7e; code += 1) {
    if (!excluded.has(String.fromCharCode(code))) values[code] = index++;
  }
  return values;
})();

function b85digit(char: string | undefined): number {
  const value = char === undefined ? -1 : (B85[char.charCodeAt(0)] ?? -1);
  if (value < 0 || value >= 85) throw new Error("SAM maskesinde geçersiz karakter.");
  return value;
}

/** 5 haneli uzunluk öneki, sonra 4 bayt başına 5 hane; kuyruk 84 ile doldurulur. */
function b85unpack(payload: string): Uint8Array {
  let length = 0;
  for (let i = 0; i < 5; i += 1) length = length * 85 + b85digit(payload[i]);
  const out = new Uint8Array(length);
  let src = 5;
  for (let dst = 0; dst < length; dst += 4) {
    const take = Math.min(4, length - dst);
    let value = 0;
    for (let i = 0; i < 5; i += 1) value = value * 85 + (i < take + 1 ? b85digit(payload[src + i]) : 84);
    src += take === 4 ? 5 : take + 1;
    for (let i = 0; i < take; i += 1) out[dst + i] = Math.floor(value / 2 ** (24 - i * 8)) & 0xff;
  }
  return out;
}

class RangeDecoder {
  private input: Uint8Array;
  private pos = 0;
  private low = 0;
  private range = 0xffffffff;
  private code = 0;
  private scaled = 0;

  constructor(input: Uint8Array) {
    if (input.length < 4) throw new Error("SAM maskesi kısa.");
    this.input = input;
    for (let i = 0; i < 4; i += 1) this.code = ((this.code << 8) | this.read()) >>> 0;
  }

  private read(): number {
    if (this.pos >= this.input.length) throw new Error("SAM maskesi erken bitti.");
    return this.input[this.pos++];
  }

  frequency(total: number): number {
    this.scaled = Math.floor(this.range / total);
    const value = Math.floor(((this.code - this.low) >>> 0) / this.scaled);
    return value >= total ? total - 1 : value;
  }

  decode(cumulative: number, frequency: number): void {
    const TOP = 1 << 24;
    const BOTTOM = 1 << 16;
    this.low = (this.low + this.scaled * cumulative) >>> 0;
    this.range = this.scaled * frequency;
    for (;;) {
      if (((this.low ^ (this.low + this.range)) >>> 0) >= TOP) {
        if (this.range >= BOTTOM) break;
        this.range = (-this.low >>> 0) & (BOTTOM - 1);
      }
      this.code = ((this.code << 8) | this.read()) >>> 0;
      this.low = (this.low << 8) >>> 0;
      this.range = (this.range << 8) >>> 0;
    }
  }
}

/** one_bit maskeyi satır öncelikli 0/1 raster'a çevirir. */
function decodeOneBit({ payload, width, height }: SamMask): Uint8Array {
  if (payload.startsWith("~")) throw new Error("SAM lossless maske döndü; one_bit istendi.");
  if (!payload.startsWith("!")) throw new Error("SAM maske kodlaması tanınmadı.");
  const decoder = new RangeDecoder(b85unpack(payload.slice(1)));
  const pad = 2;
  const pw = width + 2 * pad;
  const padded = new Uint8Array(pw * (height + pad));
  const counts = new Uint16Array((1 << 12) * 2).fill(1);
  const out = new Uint8Array(width * height);
  const at = (i: number) => padded[i];
  for (let y = 0; y < height; y += 1) {
    const row = (y + pad) * pw + pad;
    for (let x = 0; x < width; x += 1) {
      const p = row + x;
      const q = p - pw;
      const r = p - 2 * pw;
      const ctx =
        at(p - 1) | (at(p - 2) << 1) | (at(q - 2) << 2) | (at(q - 1) << 3) | (at(q) << 4) |
        (at(q + 1) << 5) | (at(q + 2) << 6) | (at(r - 2) << 7) | (at(r - 1) << 8) | (at(r) << 9) |
        (at(r + 1) << 10) | (at(r + 2) << 11);
      const off = ctx << 1;
      const zero = counts[off];
      const one = counts[off + 1];
      const bit = decoder.frequency(zero + one) < zero ? 0 : 1;
      decoder.decode(bit ? zero : 0, bit ? one : zero);
      padded[p] = bit;
      out[y * width + x] = bit;
      counts[off + bit] += 14;
      if (counts[off] + counts[off + 1] >= 4096) {
        counts[off] = counts[off] >> 1 || 1;
        counts[off + 1] = counts[off + 1] >> 1 || 1;
      }
    }
  }
  return out;
}
type Garment = { source: string; slot: string; name: string };
const D = `${ROOT}/.data`;
const CARDS = `${D}/tarif-test/avatar2-2026-10-30T14-07-07`;

const K3: Garment[] = [
  { source: `${D}/muse-test/urun-ust.jpg`, slot: "top", name: "Tudors Bej Balıksırtı Oduncu Gömlek" },
  { source: `${D}/muse-test/urun-alt.jpg`, slot: "bottom", name: "Tudors Siyah Baggy Eşofman Altı" },
  { source: `${D}/muse-test/urun-ayakkabi.jpg`, slot: "shoes", name: "Puma Speedcat OG Kırmızı" },
];
const KOMBIN: Record<string, { avatar: string; cards: string; garments: Garment[] }> = {
  K1: {
    avatar: `${D}/muse-test/avatar.jpg`,
    cards: "K1",
    garments: [
      { source: `${D}/tarif-test/urun-ust.jpg`, slot: "top", name: "Madmext Siyah Fermuarlı Yaka Kapüşonlu Erkek Sweatshirt E7161" },
      { source: `${D}/tarif-test/urun-alt.jpg`, slot: "bottom", name: "HLT JEANS Erkek Açık Mavi Taşlamalı Slim Fit Likralı Jean Kot Pantolon HLTHE001943-A" },
      { source: `${D}/tarif-test/urun-ayakkabi.jpg`, slot: "shoes", name: "Hammer Jack 101-23174 Vader Su Geçirmez Outdoor Erkek Bot SİYAH-SARI" },
    ],
  },
  K2: {
    avatar: `${D}/muse-test/avatar.jpg`,
    cards: "K2",
    garments: [
      { source: `${D}/inceleme/urun-bershka.jpg`, slot: "top", name: "Bershka Bordo Uzun Kollu Tişört" },
      { source: `${D}/inceleme/urun-palazzo.jpg`, slot: "bottom", name: "Gri Palazzo Kumaş Pantolon" },
    ],
  },
  K3: { avatar: `${D}/muse-test/avatar.jpg`, cards: "K3", garments: K3 },
  K4: { avatar: `${D}/muse-test/avatar.PNG`, cards: "K3", garments: K3 },
};

// Tarifin baş ismi: tarifte en önce geçen anahtar kelime SAM ifadesi olur.
const HEAD_NOUNS: [RegExp, string][] = [
  [/\bovershirt\b/i, "overshirt"],
  [/\bsweatshirt\b/i, "sweatshirt"],
  [/\bt-shirt\b/i, "t-shirt"],
  [/\bsweatpants\b/i, "sweatpants"],
  [/\bjeans\b/i, "jeans"],
  [/\btrousers\b/i, "trousers"],
  [/\bboots?\b/i, "boots"],
  [/\bsneakers?\b/i, "sneakers"],
];

function headNoun(description: string): string | null {
  let best: { at: number; noun: string } | null = null;
  for (const [re, noun] of HEAD_NOUNS) {
    const m = re.exec(description);
    if (m && (!best || m.index < best.at)) best = { at: m.index, noun };
  }
  return best?.noun ?? null;
}

function loadCards(name: string): { description?: string }[] {
  return JSON.parse(readFileSync(join(CARDS, `${name}-cards.json`), "utf8"));
}

// Kayıtların maskelerini tam kare raster'a yerleştirir.
async function rasterize(records: any[], width: number, height: number): Promise<Uint8Array> {
  const full = new Uint8Array(width * height);
  for (const { box, mask } of records) {
    const bits: Uint8Array = decodeOneBit(mask);
    const sx = width / (box.frameW || width);
    const sy = height / (box.frameH || height);
    const left = Math.round(box.left * sx);
    const top = Math.round(box.top * sy);
    const boxW = Math.max(1, Math.round((box.right - box.left) * sx));
    const boxH = Math.max(1, Math.round((box.bottom - box.top) * sy));
    const scaled: Buffer = await sharp(Buffer.from(bits.map((b) => b * 255)), {
      raw: { width: mask.width, height: mask.height, channels: 1 },
    })
      .resize(boxW, boxH, { fit: "fill", kernel: "nearest" })
      .extractChannel(0)
      .raw()
      .toBuffer();
    for (let y = 0; y < boxH; y += 1) {
      const fy = top + y;
      if (fy < 0 || fy >= height) continue;
      for (let x = 0; x < boxW; x += 1) {
        const fx = left + x;
        if (fx >= 0 && fx < width && scaled[y * boxW + x] > 127) full[fy * width + fx] = 255;
      }
    }
  }
  return full;
}

type SamTry = { records: any[]; phrase: string | null; tried: string[]; ms: number; calls: number; error?: string };

async function findGarment(image: Img, phrases: string[]): Promise<SamTry> {
  const out: SamTry = { records: [], phrase: null, tried: [], ms: 0, calls: 0 };
  for (const phrase of phrases) {
    out.tried.push(phrase);
    out.calls += 1;
    const t0 = Date.now();
    try {
      const recs = await samSegment({ phrase, image });
      out.ms += Date.now() - t0;
      if (recs.length) {
        out.records = recs;
        out.phrase = phrase;
        break;
      }
    } catch (err) {
      out.ms += Date.now() - t0;
      out.error = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  return out;
}

function bounds(hard: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!hard[y * w + x]) continue;
      area += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, area };
}

// Maske dışı beyaz, kenar yumuşak; sınırlayıcı kutu + her kenara %6 beyaz pay.
async function cutGarment(image: Img, hard: Uint8Array): Promise<Buffer> {
  const { width: w, height: h } = image;
  const alpha: Buffer = await sharp(Buffer.from(hard), { raw: { width: w, height: h, channels: 1 } })
    .blur(1.2)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const rgb: Buffer = await sharp(image.buffer).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    const a = alpha[i] / 255;
    for (let c = 0; c < 3; c += 1) out[i * 3 + c] = Math.round(rgb[i * 3 + c] * a + 255 * (1 - a));
  }
  const b = bounds(hard, w, h);
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const pad = Math.round(Math.max(bw, bh) * 0.06);
  const left = Math.max(0, b.x0 - pad);
  const top = Math.max(0, b.y0 - pad);
  const right = Math.min(w - 1, b.x1 + pad);
  const bottom = Math.min(h - 1, b.y1 + pad);
  const cropped: Buffer = await sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
  // Görsel kenarına dayanan tarafta eksik kalan payı beyazla tamamla (ayrı adım: sharp sırası).
  return sharp(cropped)
    .extend({
      left: pad - (b.x0 - left),
      top: pad - (b.y0 - top),
      right: pad - (right - b.x1),
      bottom: pad - (bottom - b.y1),
      background: "#ffffff",
    })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function samPhase(out: string, summary: any) {
  let n = 0;
  const done = new Map<string, any>();
  for (const [k, combo] of Object.entries(KOMBIN)) {
    const cards = loadCards(combo.cards);
    for (const [i, g] of combo.garments.entries()) {
      if (done.has(g.source)) {
        summary.garments[`${k}-${i}`] = { ...done.get(g.source), reused: true };
        continue;
      }
      n += 1;
      const id = `urun${n}`;
      const image: Img = await fitForMuse(readFileSync(g.source));
      const head = headNoun(cards[i]?.description ?? "");
      const phrases = [...new Set([...(head ? [head] : []), ...SAM_PHRASES[g.slot]])];
      const found = await findGarment(image, phrases);
      const rec: any = {
        id, source: g.source, slot: g.slot, name: g.name, head,
        phrase: found.phrase, tried: found.tried, samCalls: found.calls, samMs: found.ms, error: found.error,
      };
      if (found.records.length) {
        const hard = await rasterize(found.records, image.width, image.height);
        const b = bounds(hard, image.width, image.height);
        const ratio = b.area / (image.width * image.height);
        rec.records = found.records.length;
        rec.maskRatio = Number(ratio.toFixed(4));
        rec.boxRatio = Number((((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)) / (image.width * image.height)).toFixed(4));
        rec.suspicious = ratio < 0.03 || ratio > 0.85;
        await sharp(Buffer.from(hard), { raw: { width: image.width, height: image.height, channels: 1 } })
          .png()
          .toFile(join(out, `${id}-mask.png`));
        if (b.area > 0) writeFileSync(join(out, `${id}-cut.jpg`), await cutGarment(image, hard));
        rec.cut = b.area > 0 ? `${id}-cut.jpg` : null;
      }
      summary.samCostUsd += found.calls * SAM_COST_USD;
      done.set(g.source, rec);
      summary.garments[`${k}-${i}`] = rec;
      console.log(id, g.slot, JSON.stringify({ phrase: rec.phrase, tried: rec.tried, maskRatio: rec.maskRatio, suspicious: rec.suspicious, ms: rec.samMs, error: rec.error }));
    }
  }
}

function errorCode(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return /\[([a-z_]+)\]/.exec(text)?.[1] ?? text.slice(0, 200);
}

async function musePhase(out: string, summary: any) {
  for (const [k, combo] of Object.entries(KOMBIN)) {
    const cards = loadCards(combo.cards);
    const avatar: Img = await fitForMuse(readFileSync(combo.avatar));
    const garmentInputs = combo.garments.map((g, i) => ({ slot: g.slot, name: g.name, image: "", description: cards[i]?.description }));
    const prompt = buildPrompt(garmentInputs as any);
    writeFileSync(join(out, `${k}-prompt.txt`), prompt);
    const originals: Img[] = await Promise.all(combo.garments.map((g) => fitForMuse(readFileSync(g.source))));
    const cuts: Img[] = await Promise.all(combo.garments.map(async (g, i) => {
      const cut = summary.garments[`${k}-${i}`]?.cut;
      // Kesim yoksa orijinale düş; summary'de işaretli.
      return cut && existsSync(join(out, cut)) ? fitForMuse(readFileSync(join(out, cut))) : originals[i];
    }));
    for (const [variant, garments] of [["A", originals], ["B", cuts]] as const) {
      for (let run = 1; run <= 3; run += 1) {
        const name = `${k}-${variant}-${run}.jpg`;
        const t0 = Date.now();
        const rec: any = { file: name };
        try {
          writeFileSync(join(out, name), await meta.museEdit({ prompt, avatar, garments }));
          summary.museCostUsd += meta.MUSE_COST_USD;
        } catch (err) {
          rec.file = null;
          rec.error = errorCode(err);
          // Filtre de faturalanıyor mu bilinmiyor; üst sınır için sayılıyor.
          summary.museCostUsd += meta.MUSE_COST_USD;
        }
        rec.ms = Date.now() - t0;
        summary.muse[`${k}-${variant}-${run}`] = rec;
        console.log(k, variant, run, JSON.stringify(rec));
      }
    }
  }
}

const args = process.argv.slice(2);
const museDir = args[0] === "--muse" ? args[1] : null;
const out = museDir ?? join(D, "sam-test", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
mkdirSync(out, { recursive: true });
console.log(out);
const summaryPath = join(out, "summary.json");
const summary: any = museDir
  ? JSON.parse(readFileSync(summaryPath, "utf8"))
  : { garments: {}, muse: {}, samCostUsd: 0, museCostUsd: 0 };
const save = () => {
  summary.totalCostUsd = Number((summary.samCostUsd + summary.museCostUsd).toFixed(4));
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
};
if (!museDir) {
  await samPhase(out, summary);
  save();
}
if (!args.includes("--sam-only")) {
  await musePhase(out, summary);
  save();
}
console.log("done, total $", summary.totalCostUsd);

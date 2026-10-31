#!/usr/bin/env node
/**
 * Muse Image yüz koruma deneyi: aynı avatar ve ürünlerle istem ve referans
 * varyantlarını yan yana koşar, çıktılardaki yüzleri SAM ile bulup kırpar.
 *
 * Kullanım:
 *   node scripts/muse-face-test.mjs --avatar .data/muse-test/avatar.jpg \
 *     --garment <görsel> --slot top --name "..." \
 *     --garment <görsel> --slot bottom --name "..." [--n 3] [--variants A,B,C,D]
 *
 * Varyantlar:
 *   A  bugünkü üretim istemi (tryon.ts buildPrompt)
 *   B  kimlik istemi: neyin kalacağı tek tek sayılıyor, baş yeniden çizilmiyor
 *   C  B + avatarın yüz yakın planı ek referans görseli olarak
 *   D  C + temperature 0 (planlama adımı)
 *
 * Çıktı: .data/muse-face/<zaman>/ altında görseller, yuzler.jpg ve govde.jpg
 * karşılaştırma tabloları, summary.json. META_API_KEY .env.local'dan okunur.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const META = "https://api.meta.ai/v1";
const SLOT_EN = { top: "upper-body garment", bottom: "lower-body garment", shoes: "footwear", full: "one-piece outfit" };

function loadEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function args() {
  const a = process.argv.slice(2);
  const o = { avatar: null, garments: [], n: 3, variants: ["A", "B", "C", "D"] };
  for (let i = 0; i < a.length; i += 1) {
    const v = a[i + 1];
    if (a[i] === "--avatar") { o.avatar = v; i += 1; }
    else if (a[i] === "--garment") { o.garments.push({ source: v, slot: "top", name: "garment" }); i += 1; }
    else if (a[i] === "--slot") { o.garments.at(-1).slot = v; i += 1; }
    else if (a[i] === "--name") { o.garments.at(-1).name = v; i += 1; }
    else if (a[i] === "--n") { o.n = Number(v); i += 1; }
    else if (a[i] === "--variants") { o.variants = v.split(","); i += 1; }
  }
  if (!o.avatar || !o.garments.length) throw new Error("--avatar ve en az bir --garment gerekli.");
  return o;
}

async function load(source) {
  const buf = /^https?:/.test(source) ? Buffer.from(await (await fetch(source)).arrayBuffer()) : readFileSync(source);
  const { data, info } = await sharp(buf).rotate().flatten({ background: "#ffffff" })
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

const dataUrl = (b) => `data:image/jpeg;base64,${b.toString("base64")}`;

async function post(path, body) {
  const res = await fetch(META + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.META_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
  return json;
}

/** SAM'den ifadeye uyan ilk kutuyu döner (kaynak piksel). */
async function samBox(phrase, image) {
  const json = await post("/responses", {
    model: "sam-3.1",
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: phrase },
      { type: "input_image", image_url: dataUrl(image.buffer) },
    ] }],
    stream: false,
    metadata: { mask_encoding: "one_bit" },
  });
  const text = json.output_text ?? (json.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("\n");
  const m = /<\|box;([^|]*)\|>/.exec(text ?? "");
  if (!m) return null;
  const f = Object.fromEntries(m[1].split(";").map((p) => p.split("=")));
  const sx = image.width / Number(f.w), sy = image.height / Number(f.h);
  return { left: Number(f.x1) * sx, top: Number(f.y1) * sy, right: (Number(f.x2) + 1) * sx, bottom: (Number(f.y2) + 1) * sy };
}

/** Kutuyu kare yapıp pay bırakarak kırpar. */
async function cropSquare(image, box, size = 320, pad = 0.35) {
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const side = Math.max(box.right - box.left, box.bottom - box.top) * (1 + pad * 2);
  const left = Math.max(0, Math.round(cx - side / 2)), top = Math.max(0, Math.round(cy - side / 2));
  const w = Math.min(image.width - left, Math.round(side)), h = Math.min(image.height - top, Math.round(side));
  const cut = await sharp(image.buffer).extract({ left, top, width: w, height: h }).toBuffer();
  return sharp(cut).resize(size, size, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
}

const KEEP = "Keep any clothing item that is not being replaced.";
const NO_ADD = "Add nothing to the person that is not already visible in image 1. Do not add glasses, sunglasses, a hat, a watch, jewellery or a bag, and do not remove any such item if the person is already wearing one.";
const NO_COPY = "Do not copy the face, hair, body or pose of any model shown in the product photos. Those photos are references for the clothing only.";

function garmentLines(garments) {
  return garments.map((g, i) => `Image ${i + 2} shows the ${SLOT_EN[g.slot]} to put on the person: "${g.name}".`).join("\n");
}

/** A: tryon.ts buildPrompt ile aynı metin. */
function promptA(garments) {
  return [
    "Virtual try-on.", "Image 1 is the person.", "", garmentLines(garments), "",
    "Dress the person from image 1 in these garments. Reproduce each garment exactly as it appears in its product photo: same colour, fabric texture, knit or weave pattern, print and graphics, buttons, zips, drawstrings, collar, cuffs, hem, length and fit.",
    "", `Keep the person from image 1 exactly as they are: same face, hair, facial hair, skin tone, body shape and proportions, height, pose, hands, background, lighting and camera framing. ${KEEP}`,
    "", NO_ADD, "", NO_COPY, "", "Return one photorealistic full-body photograph of the person wearing the outfit.",
  ].join("\n");
}

/** B: değişen ve kalan açıkça ayrılıyor; baş ve yüz düzenlemenin dışında. */
function promptB(garments, faceRef) {
  const faceLine = faceRef
    ? `Image ${garments.length + 2} is a close-up of the face of the person in image 1. It is the identity reference: the face in the result must be this exact face.`
    : null;
  return [
    "Edit image 1. This is a clothing-only edit of a real photograph of a real person.",
    "", "Image 1 is the person.", garmentLines(garments), faceLine, "",
    "Change only the clothing: replace the person's garments in the matching body areas with the garments from the product photos. Reproduce each garment exactly: same colour, fabric texture, weave or knit pattern, print, buttons, zips, drawstrings, collar, cuffs, hem, length and fit.",
    "",
    "Everything else must stay pixel-identical to image 1. Do not redraw the head. The face is the same individual with the same identity: same face shape, eyes, eye colour, eyebrows, nose, mouth, ears, skin texture, facial hair and hairline, same expression and same head angle. Same body shape, height and pose, same hands, same background, same lighting and the same camera framing and position in the frame.",
    KEEP, "", NO_ADD, "", NO_COPY,
    "", "Return one photorealistic photograph: image 1 with only the clothes changed.",
  ].filter((l) => l !== null).join("\n");
}

async function main() {
  loadEnv();
  if (!process.env.META_API_KEY) throw new Error("META_API_KEY yok (.env.local).");
  const o = args();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = join(ROOT, ".data", "muse-face", stamp);
  mkdirSync(out, { recursive: true });

  const avatar = await load(o.avatar);
  const garments = [];
  for (const g of o.garments) garments.push(await load(g.source));
  writeFileSync(join(out, "avatar.jpg"), avatar.buffer);

  // Avatarın yüzü: hem referans görseli hem karşılaştırma için.
  const faceBox = await samBox("face", avatar);
  if (!faceBox) throw new Error("SAM avatarda yüz bulamadı.");
  const faceRef = { buffer: await cropSquare(avatar, faceBox, 768, 0.45) };
  writeFileSync(join(out, "yuz-referans.jpg"), faceRef.buffer);

  const variants = {
    A: { prompt: promptA(o.garments), images: [avatar, ...garments], extra: {} },
    B: { prompt: promptB(o.garments, false), images: [avatar, ...garments], extra: {} },
    C: { prompt: promptB(o.garments, true), images: [avatar, ...garments, faceRef], extra: {} },
    D: { prompt: promptB(o.garments, true), images: [avatar, ...garments, faceRef], extra: { temperature: 0 } },
  };

  const results = {};
  await Promise.all(o.variants.map(async (key) => {
    const v = variants[key];
    const started = Date.now();
    try {
      const json = await post("/images/edits", {
        model: "muse-image-1.0", prompt: v.prompt, n: o.n,
        images: v.images.map((im) => ({ image_url: dataUrl(im.buffer) })),
        size: `${avatar.width}x${avatar.height}`, response_format: "b64_json", output_format: "jpeg",
        tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
        ...v.extra,
      });
      const files = [];
      for (const [i, item] of (json.data ?? []).entries()) {
        const name = `${key}-${i + 1}.jpg`;
        writeFileSync(join(out, name), Buffer.from(item.b64_json, "base64"));
        files.push(name);
      }
      results[key] = { ms: Date.now() - started, files, prompt: v.prompt, extra: v.extra };
      console.log(`${key}: ${files.length} görsel, ${Math.round((Date.now() - started) / 1000)} sn`);
    } catch (err) {
      results[key] = { error: err.message };
      console.log(`${key}: HATA ${err.message}`);
    }
  }));

  // Yüz tablosu: ilk hücre avatar, sonra her varyantın çıktıları.
  const cell = 240, gap = 8;
  const rows = [];
  const avatarFace = await cropSquare(avatar, faceBox, cell);
  for (const key of o.variants) {
    const row = [avatarFace];
    for (const name of results[key]?.files ?? []) {
      const img = await load(join(out, name));
      const box = await samBox("face", img);
      row.push(box ? await cropSquare(img, box, cell) : await sharp({ create: { width: cell, height: cell, channels: 3, background: "#888" } }).jpeg().toBuffer());
    }
    rows.push(row);
  }
  const cols = Math.max(...rows.map((r) => r.length));
  await sharp({ create: { width: cols * (cell + gap), height: rows.length * (cell + gap), channels: 3, background: "#ff00ff" } })
    .composite(rows.flatMap((r, y) => r.map((input, x) => ({ input, left: x * (cell + gap), top: y * (cell + gap) }))))
    .jpeg({ quality: 90 }).toFile(join(out, "yuzler.jpg"));

  // Gövde tablosu.
  const bh = 520;
  const body = [];
  const avatarSmall = await sharp(avatar.buffer).resize({ height: bh }).toBuffer({ resolveWithObject: true });
  const bw = avatarSmall.info.width;
  for (const key of o.variants) {
    const row = [avatarSmall.data];
    for (const name of results[key]?.files ?? []) row.push(await sharp(join(out, name)).resize(bw, bh, { fit: "fill" }).toBuffer());
    body.push(row);
  }
  await sharp({ create: { width: cols * (bw + gap), height: body.length * (bh + gap), channels: 3, background: "#ff00ff" } })
    .composite(body.flatMap((r, y) => r.map((input, x) => ({ input, left: x * (bw + gap), top: y * (bh + gap) }))))
    .jpeg({ quality: 85 }).toFile(join(out, "govde.jpg"));

  writeFileSync(join(out, "summary.json"), JSON.stringify({ avatar: o.avatar, garments: o.garments, n: o.n, results }, null, 2));
  console.log(`Bitti: ${out}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

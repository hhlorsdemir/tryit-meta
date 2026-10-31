#!/usr/bin/env node
/**
 * Ürün tarifi deneyi (H-005 ön denemesi): Muse Spark her ürünün görselinden
 * ve adından kısa bir İngilizce tarif yazar; aynı kombin iki istemle koşar.
 *
 *   A  bugünkü üretim istemi, yalnız ürün adı (tryon.ts buildPrompt)
 *   B  ad + Spark tarifi + "tarif ile fotoğraf çelişirse fotoğrafa uy"
 *
 * Kullanım:
 *   node scripts/muse-desc-test.mjs --avatar .data/muse-test/avatar.jpg \
 *     --garment <görsel> --slot top --name "<ürün adı>" ... [--n 3]
 *
 * Çıktı: .data/tarif-test/<zaman>/ altında görseller, govde.jpg, summary.json.
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
  const o = { avatar: null, garments: [], n: 3 };
  for (let i = 0; i < a.length; i += 1) {
    const v = a[i + 1];
    if (a[i] === "--avatar") { o.avatar = v; i += 1; }
    else if (a[i] === "--garment") { o.garments.push({ source: v, slot: "top", name: "garment" }); i += 1; }
    else if (a[i] === "--slot") { o.garments.at(-1).slot = v; i += 1; }
    else if (a[i] === "--name") { o.garments.at(-1).name = v; i += 1; }
    else if (a[i] === "--n") { o.n = Number(v); i += 1; }
  }
  if (!o.avatar || !o.garments.length) throw new Error("--avatar ve en az bir --garment gerekli.");
  return o;
}

async function load(source) {
  const { data, info } = await sharp(readFileSync(source)).rotate().flatten({ background: "#ffffff" })
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

function responseText(json) {
  if (typeof json?.output_text === "string") return json.output_text;
  return (json?.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("\n");
}

/** Spark'tan tek ürün için kısa, görsele dayalı tarif. */
async function describe(garment, image) {
  const instruction = [
    `This is a product photo from an online store. The product is the ${SLOT_EN[garment.slot]} named "${garment.name}".`,
    "Describe only that product, as it looks in this photo, for an image model that will dress a different person in it.",
    "Rules: English; one line; at most 25 words; garment type, visible colour(s) as they appear in the photo, fabric look, fit and length, and the details that make it recognisable (stripes, panels, zips, hood, sole colour, laces).",
    "Ignore other clothing or accessories the model wears, the model, the background, logos of the shop and any text badges on the image.",
    "Write only what is visible. If the product name and the photo disagree (for example on colour), describe the photo.",
    'Answer with JSON only: {"description": "..."}',
  ].join("\n");
  const json = await post("/responses", {
    model: "muse-spark-1.3",
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: instruction },
      { type: "input_image", image_url: dataUrl(image.buffer) },
    ] }],
    stream: false,
  });
  const text = responseText(json);
  const m = /\{[\s\S]*\}/.exec(text);
  try {
    return JSON.parse(m ? m[0] : text).description;
  } catch {
    return text.trim().slice(0, 300);
  }
}

const TAIL = [
  "",
  "Keep the person from image 1 exactly as they are: same face, hair, facial hair, skin tone, body shape and proportions, height, pose, hands, background, lighting and camera framing. Keep any clothing item that is not being replaced.",
  "",
  "Add nothing to the person that is not already visible in image 1. Do not add glasses, sunglasses, a hat, a watch, jewellery or a bag, and do not remove any such item if the person is already wearing one.",
  "",
  "Do not copy the face, hair, body or pose of any model shown in the product photos. Those photos are references for the clothing only.",
  "",
  "Return one photorealistic full-body photograph of the person wearing the outfit.",
];
const DRESS = "Dress the person from image 1 in these garments. Reproduce each garment exactly as it appears in its product photo: same colour, fabric texture, knit or weave pattern, print and graphics, buttons, zips, drawstrings, collar, cuffs, hem, length and fit.";

function prompt(garments, withDesc) {
  const lines = garments.map((g, i) => {
    const head = `Image ${i + 2} shows the ${SLOT_EN[g.slot]} to put on the person: "${g.name}"`;
    return withDesc && g.description ? `${head} (${g.description}).` : `${head}.`;
  });
  const rule = withDesc
    ? ["", "The descriptions only help you find the right garment in each photo. The product photo is the authority on how it looks: if a description and its photo disagree, follow the photo. Use only the named garment from each photo and ignore anything else the model in it wears."]
    : [];
  return ["Virtual try-on.", "Image 1 is the person.", "", ...lines, "", DRESS, ...rule, ...TAIL].join("\n");
}

async function main() {
  loadEnv();
  if (!process.env.META_API_KEY) throw new Error("META_API_KEY yok (.env.local).");
  const o = args();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = join(ROOT, ".data", "tarif-test", stamp);
  mkdirSync(out, { recursive: true });

  const avatar = await load(o.avatar);
  const images = [];
  for (const g of o.garments) images.push(await load(g.source));
  writeFileSync(join(out, "avatar.jpg"), avatar.buffer);

  const started = Date.now();
  await Promise.all(o.garments.map(async (g, i) => { g.description = await describe(g, images[i]); }));
  console.log(`Spark tarifleri (${Math.round((Date.now() - started) / 1000)} sn):`);
  for (const g of o.garments) console.log(`  [${g.slot}] ${g.description}`);

  const variants = { A: prompt(o.garments, false), B: prompt(o.garments, true) };
  const results = {};
  await Promise.all(Object.entries(variants).map(async ([key, text]) => {
    const t0 = Date.now();
    try {
      const json = await post("/images/edits", {
        model: "muse-image-1.0", prompt: text, n: o.n,
        images: [avatar, ...images].map((im) => ({ image_url: dataUrl(im.buffer) })),
        size: `${avatar.width}x${avatar.height}`, response_format: "b64_json", output_format: "jpeg",
        tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
      });
      const files = (json.data ?? []).map((item, i) => {
        const name = `${key}-${i + 1}.jpg`;
        writeFileSync(join(out, name), Buffer.from(item.b64_json, "base64"));
        return name;
      });
      results[key] = { ms: Date.now() - t0, files, prompt: text };
      console.log(`${key}: ${files.length} görsel, ${Math.round((Date.now() - t0) / 1000)} sn`);
    } catch (err) {
      results[key] = { error: err.message, prompt: text };
      console.log(`${key}: HATA ${err.message}`);
    }
  }));

  // Gövde tablosu: satır başında avatar ve ürünler, sonra çıktılar.
  const bh = 560, gap = 8;
  const thumb = async (buf) => sharp(buf).resize({ height: bh }).toBuffer({ resolveWithObject: true });
  const head = [await thumb(avatar.buffer)];
  const bw = head[0].info.width;
  const rows = [];
  rows.push([head[0].data, ...(await Promise.all(images.map(async (im) => (await sharp(im.buffer).resize(bw, bh, { fit: "contain", background: "#ffffff" }).toBuffer()))))]);
  for (const key of Object.keys(variants)) {
    const row = [];
    for (const name of results[key]?.files ?? []) row.push(await sharp(join(out, name)).resize(bw, bh, { fit: "fill" }).toBuffer());
    rows.push(row);
  }
  const cols = Math.max(...rows.map((r) => r.length));
  await sharp({ create: { width: cols * (bw + gap), height: rows.length * (bh + gap), channels: 3, background: "#ff00ff" } })
    .composite(rows.flatMap((r, y) => r.map((input, x) => ({ input, left: x * (bw + gap), top: y * (bh + gap) }))))
    .jpeg({ quality: 85 }).toFile(join(out, "govde.jpg"));

  writeFileSync(join(out, "summary.json"), JSON.stringify({ avatar: o.avatar, garments: o.garments, n: o.n, results }, null, 2));
  console.log(`Bitti: ${out}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

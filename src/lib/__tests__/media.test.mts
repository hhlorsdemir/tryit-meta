import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEDIA_TTL_MS,
  isExpired,
  localMediaPath,
  mediaDir,
  mediaPath,
  parseMediaName,
  publicBaseUrl,
  saveMedia,
  sweepMedia,
} from "../media.ts";

const ID = "0123456789abcdef0123456789abcdef";

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

async function useTempDir(): Promise<string> {
  process.env.TRYIT_DATA_DIR = await mkdtemp(join(tmpdir(), "tryit-media-"));
  return mediaDir();
}

test("geçerli adlar ve içerik türleri", () => {
  assert.deepEqual(parseMediaName(`${ID}.jpg`), { id: ID, ext: "jpg", contentType: "image/jpeg" });
  assert.equal(parseMediaName(`${ID}.png`)?.contentType, "image/png");
  assert.equal(parseMediaName(`${ID}.webp`)?.contentType, "image/webp");
});

test("geçersiz adlar reddediliyor", () => {
  for (const name of [
    `${ID.toUpperCase()}.jpg`,
    `${ID.slice(1)}.jpg`,
    `${ID}a.jpg`,
    "../x.jpg",
    `../${ID}.jpg`,
    "a%2f.jpg",
    `${ID}.jpeg`,
    `${ID}.gif`,
    `${ID}.JPG`,
    `${ID}.jpg.tmp`,
    "",
  ]) {
    assert.equal(parseMediaName(name), null, name);
  }
});

test("mediaPath dizin dışına çıkmıyor", async () => {
  const dir = await useTempDir();
  assert.equal(mediaPath("../../etc/passwd"), null);
  assert.equal(mediaPath(`../${ID}.jpg`), null);
  assert.equal(mediaPath(`${ID}.jpg`)?.endsWith(join("media", `${ID}.jpg`)), true);
  assert.equal(mediaPath(`${ID}.jpg`)?.includes(dir.replace(/^\.\//, "")), true);
});

test("isExpired sınırları", () => {
  assert.equal(isExpired(0, 100, 100), false);
  assert.equal(isExpired(0, 101, 100), true);
  assert.equal(isExpired(100, 100, 100), false);
});

test("saveMedia geçici dosya bırakmıyor, 15 MB üstünü reddediyor", async () => {
  const dir = await useTempDir();
  const name = await saveMedia(Buffer.from("x"), "jpg");
  assert.notEqual(parseMediaName(name), null);
  assert.deepEqual(await readdir(dir), [name]);
  await assert.rejects(saveMedia(Buffer.alloc(15 * 1024 * 1024 + 1), "jpg"));
});

test("localMediaPath: geçerli ad ve dosya varsa yol, yoksa null", async () => {
  await useTempDir();
  const name = await saveMedia(Buffer.from("x"), "png");
  assert.equal(await localMediaPath(`https://baska.host/api/media/${name}`), mediaPath(name));
  assert.equal(await localMediaPath(`http://localhost:3000/api/media/${ID}.jpg`), null);
  assert.equal(await localMediaPath(`https://x.test/baska/${name}`), null);
  assert.equal(await localMediaPath(`https://x.test/api/media/../${name}`), null);
  assert.equal(await localMediaPath("adres değil"), null);
});

test("sweepMedia eskiyi ve eski .tmp'yi siliyor, yeniyi ve yabancıyı bırakıyor", async () => {
  const dir = await useTempDir();
  const fresh = await saveMedia(Buffer.from("y"), "jpg");
  const old = await saveMedia(Buffer.from("o"), "webp");
  await writeFile(join(dir, "notlar.txt"), "z");
  await writeFile(join(dir, "eski.tmp"), "t");
  await writeFile(join(dir, "yeni.tmp"), "t");

  const now = Date.now();
  const longAgo = new Date(now - MEDIA_TTL_MS - 60_000);
  await utimes(join(dir, old), longAgo, longAgo);
  await utimes(join(dir, "notlar.txt"), longAgo, longAgo);
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
  await utimes(join(dir, "eski.tmp"), twoHoursAgo, twoHoursAgo);

  const [first, second] = await Promise.all([sweepMedia(now), sweepMedia(now)]);
  assert.equal(first, second);
  assert.equal(first.removed, 2);
  assert.deepEqual((await readdir(dir)).sort(), [fresh, "notlar.txt", "yeni.tmp"].sort());
});

test("sweepMedia dizin yoksa hata vermiyor", async () => {
  process.env.TRYIT_DATA_DIR = join(tmpdir(), `tryit-yok-${Date.now()}`);
  assert.deepEqual(await sweepMedia(), { removed: 0 });
});

test("publicBaseUrl: env, yönlendirme başlıkları, host, varsayılan", () => {
  process.env.PUBLIC_BASE_URL = "https://tryit.example.com//";
  assert.equal(publicBaseUrl(req({ host: "x" })), "https://tryit.example.com");
  delete process.env.PUBLIC_BASE_URL;
  assert.equal(
    publicBaseUrl(req({ host: "app:3000", "x-forwarded-host": "tryit.lafdev.com", "x-forwarded-proto": "https" })),
    "https://tryit.lafdev.com",
  );
  assert.equal(publicBaseUrl(req({ host: "localhost:3000", "x-forwarded-proto": "http" })), "http://localhost:3000");
  assert.equal(publicBaseUrl(req({ host: "tryit.lafdev.com" })), "https://tryit.lafdev.com");
  assert.equal(publicBaseUrl(req({})), "http://localhost:3000");
  // Başlık enjeksiyonu: bilinmeyen şema ve geçersiz host karakterleri türetmeye girmez.
  assert.equal(publicBaseUrl(req({ host: "tryit.lafdev.com", "x-forwarded-proto": "javascript" })), "https://tryit.lafdev.com");
  assert.equal(publicBaseUrl(req({ host: "evil.com/x?y=" })), "http://localhost:3000");
  assert.equal(publicBaseUrl(req({ host: "a b" })), "http://localhost:3000");
});

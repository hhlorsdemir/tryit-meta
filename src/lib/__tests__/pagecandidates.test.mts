import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { collectImageCandidates, isLikelyListingPage } from "../pagecandidates.ts";

const BASE = new URL("https://shop.example.com/urun/ceket-123");
const urls = (html: string, max?: number) => collectImageCandidates(html, BASE, max).map((c) => c.url);

test("srcset içinden en büyük w seçilir", () => {
  const html = `<img srcset="/a-400.jpg 400w, /a-1600.jpg 1600w, /a-800.jpg 800w" alt="Ceket">`;
  const [first] = collectImageCandidates(html, BASE);
  assert.equal(first.url, "https://shop.example.com/a-1600.jpg");
  assert.equal(first.width, 1600);
});

test("data-src lazy görsel alınır, varlıklar çözülür", () => {
  const html = `<img class="lazy" data-src="https://cdn.example.com/p.jpg?v=1&amp;q=80">`;
  assert.deepEqual(urls(html), ["https://cdn.example.com/p.jpg?v=1&q=80"]);
});

test("data-old-hires öne gelir", () => {
  const html = `
    <img src="https://cdn.example.com/first.jpg" width="800" height="1000">
    <img src="https://cdn.example.com/thumb.jpg" data-old-hires="https://cdn.example.com/hires.jpg">`;
  assert.equal(urls(html)[0], "https://cdn.example.com/hires.jpg");
});

test("logo, ikon, svg, gif, 1x1, data: ve blob: elenir", () => {
  const html = `
    <img src="/img/logo.png"><img src="/x.jpg" class="nav-icon"><img src="/a.svg">
    <img src="/b.gif"><img src="/t.jpg" width="1" height="1"><img src="/p/1x1.png">
    <img src="data:image/png;base64,AAAA"><img src="blob:https://x/1">
    <img src="javascript:alert(1)"><img src="/ok.jpg" alt="Ürün">`;
  assert.deepEqual(urls(html), ["https://shop.example.com/ok.jpg"]);
});

test("width ve height ikisi de 200'den küçükse elenir", () => {
  const html = `<img src="/k.jpg" width="120" height="150"><img src="/b.jpg" width="120" height="900">`;
  assert.deepEqual(urls(html), ["https://shop.example.com/b.jpg"]);
});

test("göreli adresler base ile mutlaklaşır; a href ve meta okunur", () => {
  const html = `
    <a href="../buyuk/1.webp">büyüt</a><a href="/sepet">sepet</a>
    <meta property="og:image" content="//cdn.example.com/og.jpg">
    <picture><source srcset="img/s.png 1x, img/s@2x.png 2x"></picture>`;
  assert.deepEqual(urls(html).sort(), [
    "https://cdn.example.com/og.jpg",
    "https://shop.example.com/buyuk/1.webp",
    "https://shop.example.com/urun/img/s@2x.png",
  ]);
});

test("tekrarlar tekil; boyut parametresi farkında büyük olan kalır", () => {
  const html = `
    <img src="https://cdn.example.com/p.jpg?w=300">
    <img src="https://cdn.example.com/p.jpg?w=1200">
    <img src="https://cdn.example.com/p.jpg?w=300">
    <img src="https://cdn.example.com/p.jpg?color=red">`;
  assert.deepEqual(urls(html), ["https://cdn.example.com/p.jpg?w=1200", "https://cdn.example.com/p.jpg?color=red"]);
});

test("max sınırı ve eşitlikte belge sırası", () => {
  const html = Array.from({ length: 20 }, (_, i) => `<img src="/g/${i}.jpg">`).join("\n");
  const got = urls(html);
  assert.equal(got.length, 12);
  assert.equal(got[0], "https://shop.example.com/g/0.jpg");
  assert.equal(urls(html, 3).length, 3);
});

test("URL boyut ipuçları puanı yükseltir", () => {
  const html = `<img src="/x/small.jpg"><img src="https://m.media-amazon.com/images/I/abc._AC_SL1500_.jpg">`;
  assert.equal(urls(html)[0], "https://m.media-amazon.com/images/I/abc._AC_SL1500_.jpg");
});

test("isLikelyListingPage: liste sayfası true, ürün sayfası false", () => {
  const card = `<div class="product-card"><img src="/a.jpg"><span>1.299,90 TL</span></div>`;
  assert.equal(isLikelyListingPage(card.repeat(40)), true);
  const product = `<h1>Ceket</h1><img src="/a.jpg"><span>1.299,90 TL</span>${card.repeat(4)}`;
  assert.equal(isLikelyListingPage(product), false);
});

const FIXTURE = new URL("./fixtures/amazon-levis.html", import.meta.url);

test("Amazon fikstürü: media-amazon.com görseli ilk 3 adayda", { skip: !existsSync(FIXTURE) }, () => {
  const html = readFileSync(FIXTURE, "utf8");
  const top = collectImageCandidates(html, new URL("https://www.amazon.com/dp/B0000"), 3);
  assert.ok(top.some((c) => c.url.includes("media-amazon.com")), JSON.stringify(top));
});

test("kapanmayan etiket ve uzun rakam dizisi hızlı biter (ReDoS)", () => {
  const base = new URL("https://example.com/");
  let t = performance.now();
  collectImageCandidates("<a ".repeat(40_000), base);
  isLikelyListingPage("<a ".repeat(40_000));
  assert.ok(performance.now() - t < 1000, "etiket deseni yavaş");
  t = performance.now();
  isLikelyListingPage("1".repeat(40_000));
  collectImageCandidates("1".repeat(40_000), base);
  assert.ok(performance.now() - t < 1000, "fiyat deseni yavaş");
});

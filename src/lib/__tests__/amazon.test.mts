import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalAmazonUrl, isAmazonHost, readAmazon } from "../amazon.ts";

const FIXTURE = readFileSync(new URL("./fixtures/amazon-levis.html", import.meta.url), "utf8");
const PAGE = new URL("https://www.amazon.com.tr/dp/B0GNHBFMFV");

test("Levi's sayfasından ad, görsel, kategori ve fiyat okunuyor", () => {
  const product = readAmazon(FIXTURE, PAGE);
  assert.ok(product);
  assert.ok(product.name.startsWith("Levi's"), product.name);
  assert.ok(!product.name.includes("&#39;"));
  assert.equal(product.brand, "Levi's");
  assert.ok(product.images.length > 0);
  for (const src of product.images) assert.match(src, /^https:\/\/m\.media-amazon\.com\//);
  assert.equal(product.images[0], "https://m.media-amazon.com/images/I/614shTJNLvL._AC_SL1500_.jpg");
  assert.deepEqual(product.categoryPath, ["Moda", "Kadın", "Kıyafet", "Jean"]);
  // Sayfadaki fiyat 3.599,99 TL; kuruş da alınıyor.
  assert.equal(product.price, "3599.99");
  assert.equal(product.currency, "TRY");
  assert.equal(product.url, "https://www.amazon.com.tr/dp/B0GNHBFMFV");
});

test("izleme parametreli uzun link sade /dp/ASIN adresine iniyor", () => {
  const long = new URL(
    "https://www.amazon.com.tr/Levis-Straight-Kad%C4%B1n-Pantolon/dp/B0GNHBFMFV/ref=sr_1_3?crid=2X&dib=eyJ2&dib_tag=se&keywords=levis&qid=1761&sprefix=lev%2Caps&sr=8-3&psc=1&th=1&pd_rd_w=a&pf_rd_p=b&ref_=c",
  );
  assert.equal(canonicalAmazonUrl(long).toString(), "https://www.amazon.com.tr/dp/B0GNHBFMFV");
  assert.equal(
    canonicalAmazonUrl(new URL("https://www.amazon.com/gp/product/B000123ABC?psc=1")).toString(),
    "https://www.amazon.com/dp/B000123ABC",
  );
  const noAsin = new URL("https://www.amazon.com/s?k=jeans");
  assert.equal(canonicalAmazonUrl(noAsin), noAsin);
});

test("Amazon alan adları tanınıyor", () => {
  assert.equal(isAmazonHost("www.amazon.com.tr"), true);
  assert.equal(isAmazonHost("amazon.co.uk"), true);
  assert.equal(isAmazonHost("m.amazon.de"), true);
  assert.equal(isAmazonHost("www.trendyol.com"), false);
  assert.equal(isAmazonHost("amazon.com.evil.io"), false);
});

test("productTitle yoksa null", () => {
  assert.equal(readAmazon("<html><body><h1>Sepet</h1></body></html>", PAGE), null);
});

test("colorImages yoksa landingImage üzerindeki dinamik görsele düşülüyor", () => {
  const html = `<span id="productTitle"> Basic T&amp;shirt </span>
<img alt="x" id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/small.jpg&quot;:[100,100],&quot;https://m.media-amazon.com/images/I/big.jpg&quot;:[800,1000],&quot;http://evil.example/x.jpg&quot;:[2000,2000]}">`;
  const product = readAmazon(html, new URL("https://www.amazon.com/dp/B000000001"));
  assert.ok(product);
  assert.equal(product.name, "Basic T&shirt");
  assert.deepEqual(product.images, [
    "https://m.media-amazon.com/images/I/big.jpg",
    "https://m.media-amazon.com/images/I/small.jpg",
  ]);
});

test("ana fiyat bloğu dışındaki sponsorlu fiyat alınmıyor", () => {
  const head = `<span id="productTitle">Jean</span>
<img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/a.jpg&quot;:[1,1]}">
<div class="sponsored"><span class="a-price-whole">1.449</span></div>`;
  const noCore = readAmazon(head, PAGE);
  assert.ok(noCore);
  assert.equal(noCore.price, undefined);
  assert.equal(noCore.currency, undefined);

  const withCore = readAmazon(
    `${head}<div id="corePrice_feature_div"><span class="a-price-whole">3.599<span class="a-price-decimal">,</span></span><span class="a-price-fraction">00</span></div>`,
    PAGE,
  );
  assert.equal(withCore?.price, "3599");
});

test("media-amazon.com ile biten ama alt alan adı olmayan sunucu reddediliyor", () => {
  const html = `<span id="productTitle">Tisort</span>
<img id="landingImage" data-a-dynamic-image="{&quot;https://xmedia-amazon.com/images/I/evil.jpg&quot;:[2000,2000],&quot;https://m.media-amazon.com/images/I/ok.jpg&quot;:[800,1000]}">`;
  const product = readAmazon(html, new URL("https://www.amazon.com/dp/B000000001"));
  assert.ok(product);
  assert.deepEqual(product.images, ["https://m.media-amazon.com/images/I/ok.jpg"]);
});

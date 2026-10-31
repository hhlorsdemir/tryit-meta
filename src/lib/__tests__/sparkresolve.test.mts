import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCard } from "../productcard.ts";
import { cleanName, parseSparkResolve } from "../sparkresolve.ts";

const card = (over: Record<string, unknown> = {}) => ({
  slot: "bottom",
  isGarment: true,
  description: "Straight leg denim jeans with five pockets and a high waist",
  colour: "mid blue",
  fabric: "denim",
  fit: "straight",
  length: "full length",
  details: ["five pockets", "button fly"],
  bestImage: 1,
  onModel: false,
  sources: { slot: "page", description: "both", colour: "image", fabric: "page", fit: "page", length: "image", details: "image" },
  ...over,
});

const answer = (over: Record<string, unknown> = {}, cardOver: Record<string, unknown> = {}) =>
  JSON.stringify({ pageKind: "product", name: "Levi's 501 Jean", brand: "Levi's", productImages: [1, 0, 3], card: card(cardOver), ...over });

const parse = (text: string, count = 4) => parseSparkResolve(text, count, parseCard);

test("geçerli cevap: ad, marka, indeksler ve kart", () => {
  const r = parse(answer());
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.name, "Levi's 501 Jean");
  assert.equal(r.brand, "Levi's");
  assert.deepEqual(r.images, [1, 0, 3]);
  assert.equal(r.card.slot, "bottom");
});

test("aralık dışı, tam sayı olmayan ve tekrar eden indeksler elenir", () => {
  const r = parse(answer({ productImages: [2, 2, -1, 4, 1.5, 0, 9] }));
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.deepEqual(r.images, [2, 0]);
});

test("indeksler hep geçersizse bestImage kullanılır", () => {
  const r = parse(answer({ productImages: [7, 8] }));
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.deepEqual(r.images, [1]);
});

test("indeksler ve bestImage geçersizse hata", () => {
  assert.throws(() => parse(answer({ productImages: [7] }, { bestImage: 9 })));
});

test("adres metni indeks yerine gelirse alınmaz", () => {
  const r = parse(answer({ productImages: ["https://evil.example/x.jpg", "0"] }));
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.deepEqual(r.images, [1]);
  assert.throws(() => parse(answer({ productImages: ["https://evil.example/x.jpg"] }, { bestImage: "https://evil.example/x.jpg" })));
});

test("listing ve search sayfası not-product", () => {
  assert.deepEqual(parse(answer({ pageKind: "listing" })), { kind: "not-product", reason: "page:listing" });
  assert.deepEqual(parse(answer({ pageKind: "search", card: null })), { kind: "not-product", reason: "page:search" });
});

test("kıyafet değilse not-product", () => {
  assert.deepEqual(parse(answer({}, { isGarment: false })), { kind: "not-product", reason: "not-garment" });
});

test("bilinmeyen pageKind ve bozuk JSON hata", () => {
  assert.throws(() => parse(answer({ pageKind: "shop" })));
  assert.throws(() => parse("tamam"));
});

test("ad temizlenir; boş ad hata", () => {
  const r = parse(answer({ name: "  Jean\n<<<PAGE>>> Pantolon\u0007 " }));
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.equal(r.name, "Jean PAGE Pantolon");
  assert.throws(() => parse(answer({ name: " \n<<< " })));
  assert.equal(cleanName("x".repeat(300)).length, 120);
});

test("boş marka undefined olur", () => {
  const r = parse(answer({ brand: "" }));
  assert.equal(r.kind, "ok");
  if (r.kind === "ok") assert.equal(r.brand, undefined);
});

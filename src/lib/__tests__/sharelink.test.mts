import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddedTarget, stripTracking, unwrapShareLink } from "../sharelink.ts";

const PRODUCT =
  "https://www.trendyol.com/Lacoste/Erkek-Regular-Fit-Hakim-Yaka-Acik-Mavi-Bomber-Ceket-p-1198204785?boutiqueId=61&merchantId=1920&adjust_t=25l4ri4o_25q1bx32&utm_source=share&timestamp=1793311620&link_contentid=1198204785";
const ADJUST = `https://p8zh.adj.st/25l4ri4o_25q1bx32?adjust_t=x&Page=Product&adjust_redirect=${encodeURIComponent(PRODUCT)}&adj_og_title=Ceket`;

const validate = (raw: string) => new URL(raw);

function redirectTo(location: string) {
  return async () => new Response(null, { status: 302, headers: { location } });
}

test("gömülü adjust_redirect adresi okunuyor", () => {
  assert.equal(embeddedTarget(new URL(ADJUST))?.hostname, "www.trendyol.com");
  assert.equal(embeddedTarget(new URL("https://www.trendyol.com/x-p-1")), null);
});

test("takip parametreleri atılıyor, satıcı ve butik kalıyor", () => {
  const clean = stripTracking(new URL(PRODUCT));
  assert.equal(
    clean.toString(),
    "https://www.trendyol.com/Lacoste/Erkek-Regular-Fit-Hakim-Yaka-Acik-Mavi-Bomber-Ceket-p-1198204785?boutiqueId=61&merchantId=1920",
  );
});

test("ty.gl kısa linki Adjust üzerinden ürün adresine açılıyor", async () => {
  const out = await unwrapShareLink(new URL("https://ty.gl/pwzdiybwmuqyp"), validate, redirectTo(ADJUST));
  assert.equal(out.hostname, "www.trendyol.com");
  assert.match(out.pathname, /-p-1198204785$/);
  assert.equal(out.searchParams.get("utm_source"), null);
});

test("kısa link olmayan adres dokunulmadan dönüyor ve istek atılmıyor", async () => {
  let called = false;
  const url = new URL("https://www.koton.com/urun-p-1");
  const out = await unwrapShareLink(url, validate, async () => {
    called = true;
    return new Response(null);
  });
  assert.equal(out.toString(), url.toString());
  assert.equal(called, false);
});

test("istek düşerse elde kalan adresle devam ediliyor", async () => {
  const out = await unwrapShareLink(new URL("https://ty.gl/abc"), validate, async () => {
    throw new Error("ağ yok");
  });
  assert.equal(out.toString(), "https://ty.gl/abc");
});

test("yönlendirme iç ağa giderse doğrulayıcı durduruyor", async () => {
  const strict = (raw: string) => {
    const u = new URL(raw);
    if (u.hostname === "127.0.0.1") throw new Error("private-host");
    return u;
  };
  await assert.rejects(unwrapShareLink(new URL("https://ty.gl/abc"), strict, redirectTo("http://127.0.0.1/admin")));
});

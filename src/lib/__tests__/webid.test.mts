import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, newWebId, parseWebCookie, readCookie, sameOrigin, signWebId } from "../webid.ts";

const SECRET = "test-secret";

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

test("imzalı kimlik doğrulanıyor ve web- önekiyle dönüyor", () => {
  const id = newWebId();
  const parsed = parseWebCookie(signWebId(id, SECRET), SECRET);
  assert.equal(parsed, `web-${id}`);
  assert.equal(parsed?.length, 36);
  assert.match(parsed ?? "", /^[A-Za-z0-9-]{8,64}$/);
});

test("bozuk imza, başka sır ve bozuk biçim reddediliyor", () => {
  const id = newWebId();
  const value = signWebId(id, SECRET);
  const last = value.at(-1) === "A" ? "B" : "A";
  assert.equal(parseWebCookie(value.slice(0, -1) + last, SECRET), undefined);
  assert.equal(parseWebCookie(value, "baska-sir"), undefined);
  assert.equal(parseWebCookie(id, SECRET), undefined);
  assert.equal(parseWebCookie(`XYZ.${value.split(".")[1]}`, SECRET), undefined);
  assert.equal(parseWebCookie(undefined, SECRET), undefined);
  assert.equal(parseWebCookie("", SECRET), undefined);
});

test("Cookie başlığından çerez okunuyor", () => {
  const headers = new Headers({ cookie: "a=1; tryit_web=abc.def; b=2" });
  assert.equal(readCookie(headers, "tryit_web"), "abc.def");
  assert.equal(readCookie(headers, "yok"), undefined);
  assert.equal(readCookie(new Headers(), "tryit_web"), undefined);
});

test("IP: x-forwarded-for ilk girdi, sonra x-real-ip, sonra unknown", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(clientIp(new Headers({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("IP: IPv6 /64 önekine iniyor, IPv4 aynen", () => {
  const full = "2001:0db8:85a3:0042:1111:2222:3333:4444";
  assert.equal(clientIp(new Headers({ "x-forwarded-for": full })), "2001:db8:85a3:42::/64");
  assert.equal(clientIp(new Headers({ "x-real-ip": "2001:db8:85a3:42::9" })), "2001:db8:85a3:42::/64");
  assert.equal(clientIp(new Headers({ "x-real-ip": "2001:db8::1" })), "2001:db8:0:0::/64");
  assert.equal(clientIp(new Headers({ "x-real-ip": "::1" })), "0:0:0:0::/64");
  assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(new Headers({ "x-real-ip": "::ffff:203.0.113.7" })), "203.0.113.7");
});

test("sameOrigin durumları", () => {
  assert.equal(sameOrigin(req({})), false);
  assert.equal(sameOrigin(req({ host: "tryit.lafdev.com" })), false);
  assert.equal(sameOrigin(req({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameOrigin(req({ "sec-fetch-site": "none" })), true);
  assert.equal(sameOrigin(req({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameOrigin(req({ "sec-fetch-site": "same-site" })), false);
  assert.equal(sameOrigin(req({ origin: "https://tryit.lafdev.com", host: "tryit.lafdev.com" })), true);
  assert.equal(sameOrigin(req({ origin: "https://evil.example", host: "tryit.lafdev.com" })), false);
  assert.equal(
    sameOrigin(req({ origin: "https://tryit.lafdev.com", host: "tryit-app:3000", "x-forwarded-host": "tryit.lafdev.com" })),
    true,
  );
  assert.equal(sameOrigin(req({ origin: "null", host: "tryit.lafdev.com" })), false);
});

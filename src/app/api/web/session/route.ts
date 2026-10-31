import { NextResponse } from "next/server";
import { allowWebSession } from "@/lib/guard";
import {
  WEB_COOKIE,
  clientIp,
  isHttps,
  newWebId,
  parseWebCookie,
  readCookie,
  sameOrigin,
  signWebId,
  webSecret,
} from "@/lib/webid";

export const runtime = "nodejs";

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Web portalının oturumu. Geçerli çerez yoksa yeni bir kimlik üretip
 * imzalı çerez olarak yazar. Portal açılışta ve `no-session` alınca çağırır.
 */
export async function POST(request: Request) {
  const secret = webSecret();
  if (!secret) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Bu istek yetkili değil.", code: "bad-origin" }, { status: 403 });
  }

  if (parseWebCookie(readCookie(request.headers, WEB_COOKIE), secret)) {
    return NextResponse.json({ ok: true });
  }

  if (!allowWebSession(clientIp(request.headers))) {
    return NextResponse.json(
      { error: "Çok fazla deneme yaptın. Bir saat sonra tekrar dene.", code: "rate-hour" },
      { status: 429 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(WEB_COOKIE, signWebId(newWebId(), secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isHttps(request),
    maxAge: YEAR_SECONDS,
  });
  return response;
}

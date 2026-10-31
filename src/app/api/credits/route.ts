import { NextResponse } from "next/server";
import { creditStatus } from "@/lib/credits";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * Kalan kombin hakkı. Uygulama açılışta, satın almadan sonra ve abonelik
 * ekranında soruyor. Gövdede varsa StoreKit işlem kaydı (`entitlement`).
 */
export async function POST(request: Request) {
  const verdict = guard(request, "credits");
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: verdict.status });
  }

  let entitlement: unknown;
  try {
    entitlement = (await request.json())?.["entitlement"];
  } catch {
    entitlement = undefined;
  }

  try {
    return NextResponse.json(await creditStatus(verdict.device, entitlement));
  } catch (err) {
    console.error("credits failed", err);
    return NextResponse.json({ error: "Kombin hakkı okunamadı.", code: "crash" }, { status: 500 });
  }
}

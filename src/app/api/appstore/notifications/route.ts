import { NextResponse } from "next/server";
import { NotificationTypeV2 } from "@apple/app-store-server-library";
import { getVerifiers, setRevoked } from "@/lib/credits";
import { logEvent } from "@/lib/events";

export const runtime = "nodejs";

/**
 * App Store Server Notifications v2.
 *
 * Apple abonelik olaylarını buraya gönderiyor. Bizi ilgilendiren iade ve
 * iptal: iade edilen işlemin iadeden önce saklanmış kaydı kendi başına hâlâ
 * geçerli görünüyor, bildirim gelince o işlem kara listeye giriyor. İade
 * geri alınırsa listeden çıkıyor.
 *
 * Uygulama anahtarı yok, çünkü istemi Apple atıyor; güvenlik Apple'ın
 * imzasında. İmzası doğrulanmayan istek reddediliyor.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let signedPayload: unknown;
  try {
    signedPayload = (await request.json())?.["signedPayload"];
  } catch {
    signedPayload = undefined;
  }
  if (typeof signedPayload !== "string" || signedPayload.length > 100_000) {
    return NextResponse.json({ error: "Geçersiz istek.", code: "bad-body" }, { status: 400 });
  }

  for (const verifier of getVerifiers()) {
    let notification;
    try {
      notification = await verifier.verifyAndDecodeNotification(signedPayload);
    } catch {
      continue;
    }

    const type = notification.notificationType;
    const signedTx = notification.data?.signedTransactionInfo;
    let transactionId: string | undefined;
    if (signedTx) {
      try {
        transactionId = (await verifier.verifyAndDecodeTransaction(signedTx)).transactionId;
      } catch {
        transactionId = undefined;
      }
    }

    if (transactionId && (type === NotificationTypeV2.REFUND || type === NotificationTypeV2.REVOKE)) {
      await setRevoked(transactionId, true);
    } else if (transactionId && type === NotificationTypeV2.REFUND_REVERSED) {
      await setRevoked(transactionId, false);
    }

    await logEvent({
      at: new Date().toISOString(),
      event: "appstore",
      device: "apple",
      ok: true,
      ms: Date.now() - started,
      detail: [type, notification.subtype].filter(Boolean).join(" "),
    });
    // Apple 200 almazsa aynı bildirimi tekrar tekrar gönderiyor.
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "İmza doğrulanamadı." }, { status: 400 });
}

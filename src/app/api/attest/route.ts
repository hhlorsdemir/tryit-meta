import { NextResponse } from "next/server";
import { AttestError, verifyAttestation } from "@/lib/attest";
import { markAttested } from "@/lib/credits";
import { logEvent } from "@/lib/events";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";

/**
 * Cihazın App Attest doğrulaması. Geçerse cihaz ücretsiz haklarını
 * kullanabiliyor. Gövde: `keyId` ve `attestation` (ikisi de base64).
 */
export async function POST(request: Request) {
  const started = Date.now();
  let device = request.headers.get("x-tryit-device") ?? "";
  const note = (ok: boolean, code?: string, detail?: string) =>
    logEvent({ at: new Date().toISOString(), event: "attest", device, ok, code, ms: Date.now() - started, detail });

  const verdict = guard(request, "attest");
  if (!verdict.ok) {
    await note(false, verdict.code);
    return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: verdict.status });
  }
  device = verdict.device;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const keyId = body["keyId"];
  const attestation = body["attestation"];
  if (typeof keyId !== "string" || typeof attestation !== "string" || attestation.length > 20_000) {
    await note(false, "bad-body");
    return NextResponse.json({ error: "Geçersiz istek.", code: "bad-body" }, { status: 400 });
  }

  try {
    const result = verifyAttestation(device, keyId, attestation);
    await markAttested(device, result.keyId, result.environment);
    await note(true, undefined, result.environment);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof AttestError ? err.message : "Doğrulanamadı.";
    if (!(err instanceof AttestError)) console.error("attest failed", err);
    await note(false, "attest-failed", reason);
    return NextResponse.json({ error: "Cihaz doğrulanamadı.", code: "attest-failed" }, { status: 400 });
  }
}

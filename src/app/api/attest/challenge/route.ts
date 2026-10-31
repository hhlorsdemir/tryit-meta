import { NextResponse } from "next/server";
import { issueChallenge } from "@/lib/attest";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";

/** App Attest için tek kullanımlık soru. */
export async function POST(request: Request) {
  const verdict = guard(request, "attest");
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.message, code: verdict.code }, { status: verdict.status });
  }
  return NextResponse.json({ challenge: issueChallenge(verdict.device) });
}

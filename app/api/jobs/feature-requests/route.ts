import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { runFeatureRequestEmails } from "@/lib/feature-requests";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runFeatureRequestEmails(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Feature email job failed. Check server configuration and saved request delivery status.",
      },
      { status: 503 },
    );
  }
}

import { timingSafeEqual } from "node:crypto";
import { runAccountEmails } from "@/lib/account-emails";
export const runtime = "nodejs";
export const maxDuration = 150;
export async function POST(request: Request) {
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
    return Response.json(await runAccountEmails(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Account email delivery failed. Check server configuration and delivery logs.",
      },
      { status: 503 },
    );
  }
}

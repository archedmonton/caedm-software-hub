import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runAnnouncementEmails } from "@/lib/announcement-emails";
export const runtime = "nodejs";
export const maxDuration = 300;
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
    if (Number(request.headers.get("content-length") || 0) > 100)
      return Response.json({ error: "Invalid request" }, { status: 400 });
    const url = new URL(request.url);
    const testRecipient = url.searchParams.has("test")
      ? z.string().uuid().parse(url.searchParams.get("test"))
      : undefined;
    return Response.json(await runAnnouncementEmails(testRecipient), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Delivery worker unavailable. Queued messages remain saved." },
      { status: 503 },
    );
  }
}

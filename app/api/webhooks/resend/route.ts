import { Webhook } from "standardwebhooks";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicConfig } from "@/lib/env";
export const runtime = "nodejs";
export const maxDuration = 15;
const payloadSchema = z.object({
  type: z.string(),
  created_at: z.string().datetime(),
  data: z.object({
    email_id: z.string().min(1).max(200),
    tags: z.record(z.string(), z.string()).optional(),
  }),
});
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.RESEND_WEBHOOK_SECRET)
    return Response.json(
      { error: "Webhook is not configured" },
      { status: 503, headers },
    );
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        return Response.json(
          { error: "Payload too large" },
          { status: 413, headers },
        );
      }
      parts.push(chunk.value);
    }
    raw = Buffer.concat(parts).toString("utf8");
  } catch {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  }
  let verified: unknown;
  try {
    verified = new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(raw, {
      "webhook-id": request.headers.get("svix-id") || "",
      "webhook-timestamp": request.headers.get("svix-timestamp") || "",
      "webhook-signature": request.headers.get("svix-signature") || "",
    });
  } catch {
    return Response.json(
      { error: "Invalid signature" },
      { status: 401, headers },
    );
  }
  const parsed = payloadSchema.safeParse(verified);
  if (!parsed.success) return Response.json({ ignored: true }, { headers });
  const { type, data, created_at } = parsed.data;
  const kind = type.replace(/^email\./, "");
  if (
    !["delivered", "bounced", "complained", "suppressed", "failed"].includes(
      kind,
    ) ||
    !z.string().uuid().safeParse(data.tags?.delivery_ref).success
  )
    return Response.json({ ignored: true }, { headers });
  try {
    const config = publicConfig();
    // Anonymous capability RPC can update only one worker-created receipt; no service credential.
    const db = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    });
    const result = await db.rpc("record_announcement_receipt", {
      delivery_capability: data.tags!.delivery_ref,
      event_key: request.headers.get("svix-id"),
      event_kind: kind,
      provider_message_id: data.email_id,
      event_time: created_at,
    });
    if (result.error) throw new Error();
    return Response.json({ recorded: result.data === true }, { headers });
  } catch {
    return Response.json(
      { error: "Receipt storage unavailable" },
      { status: 503, headers },
    );
  }
}

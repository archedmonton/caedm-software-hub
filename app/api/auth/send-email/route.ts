import { Webhook } from "standardwebhooks";
import { authEmailMessages } from "@/lib/auth-email";
import { emailProvider } from "@/lib/email";
import { appUrl, publicConfig } from "@/lib/env";
export const runtime = "nodejs";
export const maxDuration = 10;
const headers = { "Cache-Control": "no-store" };
const failure = (status: number, message: string) =>
  Response.json(
    { error: { http_code: status, message } },
    {
      status,
      headers: {
        ...headers,
        ...(status === 503 ? { "Retry-After": "1" } : {}),
      },
    },
  );
export async function POST(request: Request) {
  const secret = process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET;
  if (!secret)
    return failure(503, "Authentication email delivery is not configured.");
  if (Number(request.headers.get("content-length") || 0) > 65536)
    return failure(413, "Invalid email hook payload.");
  let raw = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure(400, "Invalid email hook payload.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65536) {
        await reader.cancel();
        return failure(413, "Invalid email hook payload.");
      }
      chunks.push(chunk.value);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  } catch {
    return failure(400, "Invalid email hook payload.");
  }
  let payload: unknown;
  let verified = false;
  for (const value of secret.split("|")) {
    try {
      payload = new Webhook(value.trim().replace(/^v1,/, "")).verify(
        raw,
        Object.fromEntries(request.headers),
      );
      verified = true;
      break;
    } catch {
      /* Invalid signature, expired timestamp, or invalid configuration. */
    }
  }
  if (!verified) return failure(401, "Invalid email hook signature.");
  let messages;
  try {
    messages = authEmailMessages(
      payload,
      request.headers.get("webhook-id")!,
      appUrl(),
      publicConfig().url,
    );
  } catch {
    return failure(400, "Unsupported or invalid authentication email.");
  }
  try {
    const provider = emailProvider({ timeoutMs: 1800 });
    for (const message of messages) await provider.send(message);
    return Response.json({}, { headers });
  } catch {
    return failure(
      503,
      "Authentication email delivery is temporarily unavailable.",
    );
  }
}

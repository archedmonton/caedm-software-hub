import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/env";
const buckets = new Map<string, { hits: number; expires: number }>();
export async function limitAuth(email: string) {
  const key = createHash("sha256").update(email.toLowerCase()).digest("hex");
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = createClient(
      publicConfig().url,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await db.rpc("consume_auth_limit", { bucket: key });
    if (error || !data)
      throw new Error(
        "Too many attempts or authentication is temporarily unavailable. Try again later.",
      );
  } else {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Authentication rate limiting is not configured. Contact your administrator.",
      );
    const now = Date.now();
    for (const [id, entry] of buckets)
      if (entry.expires < now) buckets.delete(id);
    if (buckets.size > 10000) throw new Error("Please try again later.");
    const entry = buckets.get(key) || { hits: 0, expires: now + 15 * 60000 };
    if (++entry.hits > 15)
      throw new Error("Too many attempts. Try again in 15 minutes.");
    buckets.set(key, entry);
  }
}

import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { publicConfig, appUrl } from "@/lib/env";
import { emailProvider, type Message } from "@/lib/email";
import {
  announcementMessage,
  developerSecurityMessage,
  type AnnouncementDelivery,
} from "@/lib/announcement-content";
// Used only by the protected scheduled delivery endpoint. Business actions queue via their user's client.
export async function runAnnouncementEmails(testRecipient?: string) {
  const deadline = Date.now() + 210000;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Delivery worker is not configured.");
  const db = createClient(publicConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
  const provider = emailProvider({ timeoutMs: 6000 });
  if (
    provider.name === "smtp" &&
    process.env.EMAIL_FROM &&
    !/notifications@caedm\.ca/i.test(process.env.EMAIL_FROM)
  )
    throw new Error("Announcement sender must be notifications@caedm.ca.");
  const origin = appUrl();
  const claimed = await db.rpc("claim_announcement_emails", {
    test_recipient: testRecipient || null,
  });
  if (claimed.error || !Array.isArray(claimed.data))
    throw new Error("Announcement queue unavailable.");
  const result = { accepted: 0, failed: 0, skipped: 0, securityAccepted: 0 };
  for (const item of claimed.data as (AnnouncementDelivery & {
    claim_token: string;
    message_payload: Message | null;
  })[]) {
    if (Date.now() > deadline) break; // Unprocessed leases become eligible again after five minutes.
    let accepted = false;
    let providerId: string | undefined;
    let deliveredBy = provider.name;
    try {
      const snapshot = await db.rpc("snapshot_announcement_message", {
        recipient: item.id,
        token: item.claim_token,
        payload: item.message_payload || {
          ...announcementMessage(item, origin),
          brandLogoBase64: readFileSync(
            join(process.cwd(), "lib/assets/caedm-logo.png"),
          ).toString("base64"),
        },
      });
      if (snapshot.error) throw new Error("Message snapshot unavailable.");
      if (!snapshot.data) {
        result.skipped++;
        continue;
      }
      const receipt = await provider.send(snapshot.data as Message);
      accepted = true;
      providerId = receipt?.providerId;
      deliveredBy = receipt?.provider || provider.name;
    } catch {
      /* Transport emits safe diagnostics. */
    }
    const saved = await db.rpc("finish_announcement_email", {
      recipient: item.id,
      token: item.claim_token,
      accepted,
      email_provider: deliveredBy,
      provider_message_id: providerId || null,
    });
    if (saved.error || saved.data !== true)
      throw new Error("Delivery result could not be recorded.");
    result[accepted ? "accepted" : "failed"]++;
  }
  if (!testRecipient && Date.now() < deadline) {
    const security = await db.rpc("claim_developer_security_emails");
    if (security.error || !Array.isArray(security.data))
      throw new Error("Security notice queue unavailable.");
    for (const item of security.data) {
      if (Date.now() > deadline) break;
      let accepted = false;
      try {
        await provider.send(developerSecurityMessage(item, origin));
        accepted = true;
      } catch {
        /* Safe transport diagnostics only. */
      }
      const saved = await db.rpc("finish_developer_security_email", {
        notification: item.id,
        token: item.claim_token,
        accepted,
      });
      if (saved.error || !saved.data)
        throw new Error("Security notice result unavailable.");
      if (accepted) result.securityAccepted++;
      else result.failed++;
    }
  }
  return result;
}

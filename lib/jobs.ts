import "server-only";
import { createClient } from "@supabase/supabase-js";
import { appUrl, publicConfig } from "@/lib/env";
import { emailProvider } from "@/lib/email";
import { cents, money } from "@/lib/domain";
type Notification = {
  id: string;
  claim_token: string;
  kind: string;
  email: string;
  full_name: string;
  review_id: string;
  software_name: string;
  renewal_date: string;
  deadline: string;
  amount: string;
  currency: string;
};
export async function runReminders() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("The reminder server credential is missing.");
  const provider = emailProvider();
  const origin = appUrl();
  const db = createClient(
    publicConfig().url,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await db.rpc("prepare_reminders");
  if (error) throw new Error("Could not prepare reminders.");
  const { data, error: claimError } = await db.rpc("claim_notifications");
  if (claimError) throw new Error("Could not claim notification queue.");
  let sent = 0,
    failed = 0;
  for (const n of data as Notification[]) {
    const subject =
      n.kind === "response"
        ? `Usage response recorded: ${n.software_name}`
        : n.kind === "escalation"
          ? `Overdue software decision: ${n.software_name}`
          : `Usage confirmation: ${n.software_name}`;
    const text = `Hello ${n.full_name},\n\n${n.kind === "response" ? "A usage response is ready for Finance to review." : "Please review whether this software is still needed."}\n\nSoftware: ${n.software_name}\nRenewal: ${n.renewal_date}\nDecision deadline: ${n.deadline}\nBilling amount: ${money(cents(n.amount), n.currency)} ${n.currency}\n\nOpen the authenticated review page: ${origin}/reviews/${n.review_id}\n\nThis request does not cancel any subscription with a vendor.\nCAEDM Software Hub`;
    let successful = false;
    try {
      await provider.send({ id: n.id, to: n.email, subject, text });
      successful = true;
    } catch {
      /* Persist a safe error without SMTP credentials or vendor responses. */
    }
    const { error: finishError } = await db.rpc("finish_notification", {
      notification: n.id,
      token: n.claim_token,
      successful,
      email_provider: provider.name,
      email_subject: subject,
      email_body: text,
    });
    if (finishError)
      throw new Error(
        "Delivery state could not be saved. Check notification attempts before retrying.",
      );
    if (successful) sent++;
    else failed++;
  }
  return { sent, failed };
}

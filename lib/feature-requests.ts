import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "@/lib/env";
import { emailProvider } from "@/lib/email";
import {
  featureRequestMessage,
  type FeatureRequestMessage,
} from "@/lib/feature-request-content";

// Only the protected scheduled job calls these functions. Submission, history and
// retry queueing always use the signed-in user's client.
function deliveryClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Feature email job credential is missing.");
  return createClient(publicConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
}
export async function runFeatureRequestEmails() {
  const { data, error } = await deliveryClient().rpc(
    "pending_feature_request_deliveries",
  );
  if (error || !Array.isArray(data))
    throw new Error("Could not read feature email queue.");
  const counts = { sent: 0, failed: 0, sending: 0 };
  for (const row of data as { id: string; requester_id: string }[]) {
    const result = await deliverFeatureRequest(row.id, row.requester_id);
    counts[result.status]++;
  }
  return counts;
}
export async function deliverFeatureRequest(id: string, requesterId: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    return {
      status: "failed" as const,
      message:
        "Your request is saved, but email delivery is not configured. Contact the developer with its reference.",
    };
  const admin = createClient(publicConfig().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
  let claimed: {
    status: string;
    claim?: string;
    request?: FeatureRequestMessage;
  };
  try {
    const { data, error } = await admin.rpc("claim_feature_request_delivery", {
      request_id: id,
      employee: requesterId,
    });
    if (error || !data)
      return {
        status: "failed" as const,
        message:
          error && /Wait one minute/.test(error.message)
            ? "Wait one minute before retrying email delivery."
            : "Your request is saved. Email delivery is unavailable; contact the developer with its reference.",
      };
    claimed = data;
  } catch {
    return {
      status: "failed" as const,
      message:
        "Your request is saved. Email delivery is temporarily unavailable. Try again later.",
    };
  }
  if (claimed.status === "sent") return { status: "sent" as const };
  if (claimed.status === "sending")
    return {
      status: "sending" as const,
      message:
        "Your request is saved and email delivery is already in progress.",
    };
  if (claimed.status === "failed")
    return {
      status: "failed" as const,
      message:
        "Email retry limit reached. Contact the developer with your request reference.",
    };
  if (!claimed.claim || !claimed.request)
    return {
      status: "failed" as const,
      message: "Your request is saved. Email delivery could not be started.",
    };
  let successful = false;
  try {
    await emailProvider().send(featureRequestMessage(claimed.request));
    successful = true;
  } catch {
    // SMTP responses and submitted request text never enter logs or error messages.
  }
  try {
    const { error } = await admin.rpc("finish_feature_request_delivery", {
      request_id: id,
      claim: claimed.claim,
      successful,
    });
    if (error && successful)
      return {
        status: "sending" as const,
        message:
          "The email was sent, but its status could not be confirmed. Refresh your recent requests before retrying.",
      };
  } catch {
    if (successful)
      return {
        status: "sending" as const,
        message:
          "The email was sent, but its status could not be confirmed. Refresh your recent requests before retrying.",
      };
  }
  return successful
    ? { status: "sent" as const }
    : {
        status: "failed" as const,
        message:
          "Your request is saved. Email delivery failed; retry later or contact the developer with its reference.",
      };
}

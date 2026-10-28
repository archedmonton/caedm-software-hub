"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { session } from "@/lib/auth";
import {
  eligibleFeatureRequester,
  featureRequestInput,
  type FeatureRequestReceipt,
} from "@/lib/feature-request-content";

export type FeatureRequestState = {
  error?: string;
  success?: string;
  receipt?: FeatureRequestReceipt;
  delivery?: string;
};
export async function submitFeatureRequest(
  _state: FeatureRequestState,
  form: FormData,
): Promise<FeatureRequestState> {
  const { db, profile, user } = await session();
  if (!eligibleFeatureRequester(profile, user))
    return {
      error:
        "Verify your CAEDM work email first. Feature requests are available to active accounts and accounts awaiting approval.",
    };
  const parsed = featureRequestInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const value = parsed.data;
  const { data, error } = await db.rpc("submit_feature_request", {
    client_key: value.request_key,
    request_title: value.title,
    request_area: value.area,
    request_priority: value.priority,
    request_department: value.department,
    request_problem: value.problem,
    request_solution: value.solution,
    request_benefit: value.benefit,
    request_workaround: value.workaround,
  });
  if (error || !data)
    return {
      error:
        error && /limit reached|different details/.test(error.message)
          ? error.message
          : "Your request could not be saved. Your form details are retained; try again or contact the developer.",
    };
  const receipt = data as FeatureRequestReceipt;
  revalidatePath("/request-feature");
  return {
    receipt,
    delivery: receipt.delivery_status,
    success:
      receipt.delivery_status === "sent"
        ? "Your request has been saved and sent to Ruban Peppin for review."
        : "Your request has been saved and queued for email delivery to Ruban Peppin. Check Your recent requests for delivery status.",
  };
}
export async function retryFeatureRequest(
  _state: FeatureRequestState,
  form: FormData,
): Promise<FeatureRequestState> {
  const { db, profile, user } = await session();
  if (!eligibleFeatureRequester(profile, user))
    return {
      error:
        "This account cannot send feature requests. Contact the developer for help.",
    };
  const id = z.string().uuid().safeParse(form.get("request_id"));
  if (!id.success) return { error: "Invalid request reference." };
  // Ownership, eligibility and retry limits are enforced again inside PostgreSQL.
  const { data, error } = await db.rpc("retry_feature_request_email", {
    request_id: id.data,
  });
  if (error || !data)
    return {
      error:
        error && /Wait one minute|retry limit/.test(error.message)
          ? error.message
          : "This request cannot be retried right now. Contact the developer with its reference.",
    };
  revalidatePath("/request-feature");
  return data.status === "sent"
    ? { success: "The request email has been sent to Ruban Peppin." }
    : data.status === "sending"
      ? {
          success:
            "Email delivery is already in progress. Refresh your recent requests shortly.",
        }
      : {
          success:
            "Your request is queued for email delivery. Refresh your recent requests after the next delivery run.",
        };
}

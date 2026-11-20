"use server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDeveloper } from "@/lib/developer-auth";
import { announcementMessage } from "@/lib/announcement-content";
import { emailBrand } from "@/lib/email-brand";
import { appUrl } from "@/lib/env";
import type { AnnouncementPreview } from "@/lib/announcement-types";
export type ComposerState = {
  error?: string;
  success?: string;
  preview?: AnnouncementPreview;
};
const schema = z.object({
  id: z.string().uuid(),
  template: z.enum(["welcome", "whats_new", "blank"]),
  title: z.string().trim().min(1).max(200),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .regex(/^[^\r\n]+$/),
  body: z.string().trim().min(10).max(20000),
  audience: z.enum(["signed_up", "invited", "everyone", "selected"]),
  selected: z
    .array(
      z
        .string()
        .email()
        .regex(/@caedm\.ca$/i),
    )
    .max(1000),
});
export async function previewAnnouncement(
  _previous: ComposerState,
  form: FormData,
): Promise<ComposerState> {
  const { db } = await requireDeveloper();
  try {
    const input = schema.parse({
      ...Object.fromEntries(form),
      selected: form.getAll("selected"),
    });
    const saved = await db.rpc("save_developer_announcement", {
      announcement: input.id,
      chosen_template: input.template,
      announcement_title: input.title,
      email_subject: input.subject,
      email_body: input.body,
      audience_kind: input.audience,
      selected: input.selected,
    });
    if (saved.error)
      return {
        error:
          "Draft could not be saved. It may already be queued or the hourly limit was reached.",
      };
    const preview = await db.rpc("preview_developer_announcement", {
      announcement: input.id,
    });
    if (preview.error)
      return {
        error: "Preview is unavailable. Check current Developer authorization.",
      };
    const value = preview.data;
    const email = announcementMessage(
      {
        ...value.announcement,
        email: value.sender.email,
        full_name: value.sender.full_name,
        reply_to: value.sender.email,
        is_test: true,
      },
      appUrl(),
    );
    const logo = readFileSync(
      join(process.cwd(), "lib/assets/caedm-logo.png"),
    ).toString("base64");
    return {
      preview: {
        ...value,
        html: email.html!.replaceAll(
          `cid:${emailBrand.logoCid}`,
          `data:image/png;base64,${logo}`,
        ),
      },
    };
  } catch {
    return {
      error:
        "Enter a title, a one-line subject, a message of 10–20,000 characters and a valid audience.",
    };
  }
}
export async function testAnnouncement(id: string) {
  const { db } = await requireDeveloper();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "Invalid draft." };
  const queued = await db.rpc("queue_announcement_test", { announcement: id });
  if (queued.error)
    return {
      error:
        "Preview the current draft first. Your address must remain eligible for email.",
    };
  // Invoke only the protected bounded worker, not a service client in this business action.
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    return {
      error:
        "Test is saved in the queue. Configure the protected announcement worker before sending.",
    };
  try {
    const response = await fetch(
      `${appUrl()}/api/jobs/announcements?test=${queued.data}`,
      {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(25000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      return {
        error:
          "Test remains saved. Delivery is unavailable; inspect Email Outbox before trying again.",
      };
    const proof = await db
      .from("developer_announcements")
      .select("content_hash,test_accepted_hash")
      .eq("id", id)
      .single();
    if (
      !proof.data ||
      proof.data.content_hash !== proof.data.test_accepted_hash
    )
      return {
        error:
          "The provider has not accepted the test. Check Email Outbox and retry safely.",
      };
    return {
      success:
        "Test accepted by the email provider. Review the test email, then confirm your audience.",
    };
  } catch {
    return {
      error: "The test is queued. Refresh delivery status before retrying.",
    };
  }
}
export async function queueAnnouncement(
  id: string,
  count: number,
  confirmed: boolean,
) {
  const { db } = await requireDeveloper();
  if (
    !z.string().uuid().safeParse(id).success ||
    !Number.isInteger(count) ||
    count < 1 ||
    confirmed !== true
  )
    return { error: "Review the recipient count and confirm the send." };
  const result = await db.rpc("queue_developer_announcement", {
    announcement: id,
    expected_count: count,
    confirmed,
  });
  if (result.error)
    return {
      error:
        "Queueing was prevented. Preview and test the current draft again, then recheck the recipient count.",
    };
  revalidatePath("/developer");
  return {
    success: `${result.data} individual messages saved in the delivery queue.`,
  };
}
export async function retryAnnouncement(form: FormData) {
  const { db } = await requireDeveloper();
  const id = z.string().uuid().parse(form.get("id"));
  const result = await db.rpc("retry_developer_announcement", {
    announcement: id,
  });
  if (result.error) throw new Error("Failed messages could not be retried.");
  revalidatePath("/developer");
}

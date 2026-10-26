import { requireAccess } from "@/lib/auth";
import { allRows, subscriptionSelect } from "@/lib/data";
import { SoftwareForm } from "@/components/hub/software-form";
import { PageHeading } from "@/components/hub/common";
import type { Team, Profile, Subscription } from "@/lib/domain";
import { notFound } from "next/navigation";
export async function SoftwareEditor({ id }: { id?: string }) {
  const { db } = await requireAccess();
  const [teams, vendors, people, payments, members, settings] =
    await Promise.all([
      allRows<Team>(db, "teams"),
      allRows<{ id: string; name: string }>(db, "vendors"),
      allRows<Profile>(db, "profiles"),
      allRows<{
        id: string;
        team_id: string;
        nickname: string;
        last_four: string;
      }>(db, "payment_methods"),
      allRows<{ team_id: string; profile_id: string; can_manage: boolean }>(
        db,
        "team_members",
      ),
      db.from("application_settings").select("currencies").single(),
    ]);
  let existing: Subscription | undefined;
  if (id) {
    const { data } = await db
      .from("software_subscriptions")
      .select(subscriptionSelect)
      .eq("id", id)
      .maybeSingle();
    if (!data) notFound();
    existing = data as unknown as Subscription;
  }
  return (
    <>
      <PageHeading
        eyebrow="SOFTWARE INVENTORY"
        title={id ? "Edit software" : "Add software"}
        description="A few details now. Better decisions at every renewal."
      />
      <SoftwareForm
        existing={existing}
        teams={teams}
        vendors={vendors}
        people={people}
        payments={payments}
        members={members}
        currencies={settings.data?.currencies || ["CAD", "USD"]}
      />
    </>
  );
}

import { requireAccess } from "@/lib/auth";
import { allRows, subscriptionSelect } from "@/lib/data";
import { SoftwareForm } from "@/components/hub/software-form";
import { PageHeading } from "@/components/hub/common";
import {
  adminRole,
  type Team,
  type Profile,
  type Subscription,
} from "@/lib/domain";
import type { NamedReference, EditorEmployee } from "@/lib/software-reference";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
async function eligibleEmployees(
  db: SupabaseClient,
): Promise<EditorEmployee[]> {
  const result: EditorEmployee[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .rpc("software_employee_candidates")
      .range(offset, offset + 499);
    if (error)
      throw new Error(
        "Employee choices could not be loaded. Refresh and try again.",
      );
    result.push(...(data as EditorEmployee[]));
    if (data.length < 500) return result;
  }
}
export async function SoftwareEditor({ id }: { id?: string }) {
  const { db, profile } = await requireAccess();
  const [
    teams,
    vendors,
    people,
    payments,
    members,
    settings,
    categories,
    legacyCategories,
    employeeCandidates,
  ] = await Promise.all([
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
    allRows<NamedReference>(db, "software_categories", "id,name"),
    allRows<{ id: string; category: string }>(
      db,
      "software_subscriptions",
      "id,category",
    ),
    adminRole(profile.role) ? eligibleEmployees(db) : Promise.resolve([]),
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
        role={profile.role}
        categories={[
          ...new Set([
            ...categories.map((c) => c.name),
            ...legacyCategories.map((c) => c.category),
          ]),
        ]}
        employeeCandidates={employeeCandidates}
      />
    </>
  );
}

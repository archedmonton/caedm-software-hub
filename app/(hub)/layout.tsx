import { requireAccess } from "@/lib/auth";
import { Shell } from "@/components/hub/shell";
export const dynamic = "force-dynamic";
export default async function HubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db, profile } = await requireAccess();
  const { count } = await db
    .from("usage_reviews")
    .select("id", { count: "exact", head: true })
    .is("response", null);
  return (
    <Shell profile={profile} notifications={count || 0}>
      {children}
    </Shell>
  );
}

import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { subscriptions } from "@/lib/data";
import { Inventory } from "@/components/hub/inventory";
import { PageHeading } from "@/components/hub/common";
import { Button } from "@/components/ui/button";
export default async function Software() {
  const { db } = await requireAccess();
  const rows = await subscriptions(db);
  return (
    <>
      <PageHeading
        eyebrow="THE SOFTWARE REGISTER"
        title="Software inventory"
        description="One reliable place for your software, owners, and commitments."
      >
        <Button asChild>
          <Link href="/software/new">
            <Plus />
            Add software
          </Link>
        </Button>
      </PageHeading>
      <Inventory software={rows} />
    </>
  );
}

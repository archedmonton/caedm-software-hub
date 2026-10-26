import { AuditHistory } from "@/components/hub/audit-history";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { ExpenseCorrection } from "@/components/hub/expense-correction";
import { PageHeading } from "@/components/hub/common";
export default async function EditExpense({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db } = await requireAccess("finance");
  const { data } = await db
    .from("expense_records")
    .select("id,transaction_date,amount,tax,currency,invoice_reference,notes")
    .eq("id", id)
    .single();
  if (!data) notFound();
  return (
    <>
      <PageHeading
        eyebrow="FINANCE CENTRE"
        title="Correct an expense"
        description="Corrections are retained in the audit history. Original department and payment snapshots are preserved."
      />
      <ExpenseCorrection expense={data} />
      <AuditHistory recordId={id} />
    </>
  );
}

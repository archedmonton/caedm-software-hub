"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctExpense, type Result } from "@/app/(hub)/actions";
import { Feedback } from "@/components/hub/controls";
import { Button } from "@/components/ui/button";
export function ExpenseCorrection({
  expense,
}: {
  expense: {
    id: string;
    transaction_date: string;
    amount: number;
    tax: number;
    currency: string;
    invoice_reference: string;
    notes: string;
  };
}) {
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="panel p-7 max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        if (!window.confirm("Save this correction to the confirmed expense?"))
          return;
        start(async () => {
          const result = await correctExpense(expense.id, values);
          setResult(result);
          if (result.success) {
            router.push("/finance");
            router.refresh();
          }
        });
      }}
    >
      <div className="form-grid">
        <label>
          Transaction date
          <input
            type="date"
            name="transaction_date"
            defaultValue={expense.transaction_date}
            required
          />
        </label>
        <label>
          Amount excluding tax
          <input
            type="number"
            name="amount"
            step="0.01"
            min="0"
            defaultValue={expense.amount}
            required
          />
        </label>
        <label>
          Tax
          <input
            type="number"
            name="tax"
            step="0.01"
            min="0"
            defaultValue={expense.tax}
            required
          />
        </label>
        <label>
          Currency
          <input
            name="currency"
            pattern="[A-Z]{3}"
            maxLength={3}
            defaultValue={expense.currency}
            required
          />
        </label>
        <label className="wide">
          Invoice reference
          <input
            name="invoice_reference"
            defaultValue={expense.invoice_reference}
          />
        </label>
        <label className="wide">
          Notes / reason for correction
          <textarea name="notes" defaultValue={expense.notes} rows={3} />
        </label>
      </div>
      <Feedback result={result} />
      <Button disabled={pending}>
        {pending ? "Saving…" : "Save correction"}
      </Button>
    </form>
  );
}

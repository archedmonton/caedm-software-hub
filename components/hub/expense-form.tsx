"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveExpense, type Result } from "@/app/(hub)/actions";
import { today } from "@/lib/domain";
import { Feedback } from "@/components/hub/controls";
import { Button } from "@/components/ui/button";
export function ExpenseForm({
  software,
  currencies,
}: {
  software: { id: string; name: string }[];
  currencies: string[];
}) {
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <details className="panel p-6 mb-6">
      <summary className="font-semibold cursor-pointer">
        + Record a confirmed expense
      </summary>
      <form
        className="form-grid mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const input = Object.fromEntries(new FormData(form));
          if (!window.confirm("Record this confirmed accounting expense?"))
            return;
          start(async () => {
            const outcome = await saveExpense(input);
            setResult(outcome);
            if (outcome.success) {
              form.reset();
              router.refresh();
            }
          });
        }}
      >
        <label>
          Software
          <select name="subscription_id" required>
            <option value="">Select software</option>
            {software.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Invoice / transaction date
          <input
            name="transaction_date"
            type="date"
            defaultValue={today()}
            required
          />
        </label>
        <label>
          Amount excluding tax
          <input name="amount" type="number" min="0" step="0.01" required />
        </label>
        <label>
          Tax recorded
          <input
            name="tax"
            type="number"
            min="0"
            step="0.01"
            defaultValue="0.00"
            required
          />
        </label>
        <label>
          Currency
          <select name="currency">
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Invoice reference
          <input name="invoice_reference" maxLength={500} />
        </label>
        <label className="wide">
          Notes
          <textarea name="notes" rows={2} maxLength={3000} />
        </label>
        <div className="wide">
          <Feedback result={result} />
          <Button disabled={pending}>
            {pending ? "Recording…" : "Record expense"}
          </Button>
          <p className="field-hint mt-3">
            Only record confirmed transactions. Renewals are never inserted as
            expenses automatically.
          </p>
        </div>
      </form>
    </details>
  );
}

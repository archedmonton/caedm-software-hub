"use client";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/hub/field-help";
import { SubmissionError } from "@/components/hub/submission-error";
import { saveBillingReminderPreferences } from "@/app/(hub)/settings/reminder-actions";
import {
  billingReminderDefaults,
  billingReminderSchema,
  type BillingReminderPreferences,
} from "@/lib/billing-reminders";
export function BillingPreferences({
  preferences,
  available,
}: {
  preferences: BillingReminderPreferences;
  available: boolean;
}) {
  const id = useId();
  const editable = (p: BillingReminderPreferences) => ({
    ...p,
    first_notice_days: String(p.first_notice_days),
    second_notice_days: String(p.second_notice_days),
  });
  const [values, setValues] = useState(editable(preferences));
  const [result, setResult] = useState<{ error?: string; success?: string }>(
    {},
  );
  const [pending, start] = useTransition();
  if (!available)
    return (
      <p className="notice">
        Billing preferences are temporarily unavailable. Ask an administrator to
        complete database setup. Default reminders apply when setup is complete.
      </p>
    );
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = billingReminderSchema.safeParse(values);
        if (!parsed.success) {
          setResult({ error: parsed.error.issues[0].message });
          const field = parsed.error.issues[0].path[0];
          if (field === "first_notice_days" || field === "second_notice_days")
            e.currentTarget
              .querySelector<HTMLInputElement>(`[name="${field}"]`)
              ?.focus();
          return;
        }
        start(async () => {
          try {
            setResult(await saveBillingReminderPreferences(parsed.data));
          } catch {
            setResult({
              error:
                "The save could not be confirmed. Your choices are still here. Refresh before retrying.",
            });
          }
        });
      }}
    >
      <label className="billing-preference-toggle">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => {
            setValues({ ...values, enabled: e.target.checked });
            setResult({});
          }}
          disabled={pending}
        />
        Email me before billing for software I own
      </label>
      <div className="form-grid">
        {(
          [
            ["first_notice_days", "First billing notice"],
            ["second_notice_days", "Second billing notice"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="editor-field">
            <div className="editor-field-label">
              <label htmlFor={id + key}>{label} (days before billing)</label>
              <FieldHelp
                id={id + key + "-help"}
                title={label}
                text="Choose whole calendar days before the expected billing date. The first notice must be earlier than the second, for example 14 and 7. These preferences affect only your billing emails, not usage reviews. Dates use America/Edmonton."
              />
            </div>
            <input
              id={id + key}
              name={key}
              type="number"
              min={key === "first_notice_days" ? 2 : 1}
              max={key === "first_notice_days" ? 365 : 364}
              required
              value={values[key]}
              onChange={(e) => {
                setValues({ ...values, [key]: e.target.value });
                setResult({});
              }}
              disabled={pending}
              aria-describedby={
                result.error ? id + "-error" : id + key + "-help"
              }
              aria-invalid={Boolean(result.error)}
            />
          </div>
        ))}
      </div>
      <p className="field-hint">
        Defaults are 14 and 7 days before billing. Your choices apply to
        subscriptions you own. Missed runs send only the latest due notice;
        notices are not sent on or after the billing date. Usage reviews and
        Finance escalations continue separately.
      </p>
      {result.error && (
        <SubmissionError id={id + "-error"} message={result.error} />
      )}
      {result.success && (
        <p className="notice" role="status">
          {result.success}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save billing preferences"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setValues(editable(billingReminderDefaults));
            setResult({});
          }}
        >
          Restore defaults
        </Button>
      </div>
    </form>
  );
}

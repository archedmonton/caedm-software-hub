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
  const [saved, setSaved] = useState(preferences);
  const [result, setResult] = useState<{ error?: string; success?: string }>(
    {},
  );
  const [pending, start] = useTransition();
  if (!available)
    return (
      <p className="notice">
        Notification settings are temporarily unavailable. Ask an administrator
        to complete database setup. Existing saved preferences remain in effect.
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
            const response = await saveBillingReminderPreferences(parsed.data);
            setResult(response);
            if (response.success) setSaved(parsed.data);
          } catch {
            setResult({
              error:
                "The save could not be confirmed. Your choices are still here. Refresh before retrying.",
            });
          }
        });
      }}
    >
      <div className="notification-switch-row">
        <div>
          <strong id={id + "-enabled-label"}>
            Software email notifications
          </strong>
          <p id={id + "-enabled-description"}>
            Billing notices, Usage Review requests and Finance updates.
          </p>
        </div>
        <div className="notification-switch-control">
          <span aria-hidden="true">{values.enabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            className="notification-switch"
            aria-checked={values.enabled}
            aria-labelledby={id + "-enabled-label"}
            aria-describedby={id + "-enabled-description"}
            disabled={pending}
            onClick={() => {
              const discardTiming =
                values.enabled &&
                !billingReminderSchema.safeParse(values).success;
              setValues({
                ...values,
                enabled: !values.enabled,
                ...(discardTiming
                  ? {
                      first_notice_days: String(saved.first_notice_days),
                      second_notice_days: String(saved.second_notice_days),
                    }
                  : {}),
              });
              setResult(
                discardTiming
                  ? {
                      success:
                        "Invalid timing edits were discarded. Save to turn notifications off using your previous timings.",
                    }
                  : {},
              );
            }}
          >
            <span className="notification-switch-track" aria-hidden="true">
              <span />
            </span>
          </button>
        </div>
      </div>
      <fieldset
        disabled={pending || !values.enabled}
        className="notification-options"
      >
        <div className="notification-scope">
          <label className="billing-preference-toggle">
            <input
              type="checkbox"
              checked={values.only_owned}
              onChange={(e) => {
                setValues({ ...values, only_owned: e.target.checked });
                setResult({});
              }}
              disabled={pending}
            />
            Only software I own
          </label>
          <p className="field-hint">
            Checked: include only software assigned to you. Unchecked: include
            all software you are authorized to view. Review requests still go to
            their assigned reviewer; Finance updates still require the
            appropriate role.
          </p>
        </div>
        <div className="editor-field-label mb-3">
          <h3>Billing notice timing</h3>
          <FieldHelp
            id={id + "-scope-help"}
            title="Notification scope"
            text="Ownership and email enablement are separate controls. All software means only records available through your role and departments. These settings never grant new access or make you responsible for someone else's review. Turn off the switch to stop all software reminder emails, then save. Account security and invitation emails continue."
          />
        </div>
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
                  text="Choose whole calendar days before the expected billing date. The first notice must be earlier than the second, for example 14 and 7. These day offsets affect billing emails only; review deadlines and frequency still follow organization rules. Dates use America/Edmonton."
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
                disabled={pending || !values.enabled}
                aria-describedby={
                  result.error ? id + "-error" : id + key + "-help"
                }
                aria-invalid={Boolean(result.error)}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <p className="field-hint">
        Billing notices default to 14 and 7 days before billing. Changes apply
        when you save. Turning notifications off preserves your scope and
        timings. Review assignments and in-app work items remain available;
        invitations, verification and password resets continue. Missed billing
        runs send only the latest due notice, before the billing date.
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
          {pending ? "Saving…" : "Save notification settings"}
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

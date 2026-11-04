"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { respondReview, type Result } from "@/app/(hub)/actions";
import { Feedback } from "@/components/hub/controls";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/hub/field-help";
import { reviewHelp } from "@/lib/review-help";
export function ReviewForm({ id }: { id: string }) {
  const formId = useId();
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        start(async () => {
          const outcome = await respondReview({ id, ...data });
          setResult(outcome);
          if (outcome.success) router.refresh();
        });
      }}
      className="space-y-6"
    >
      <fieldset aria-describedby={formId + "-response-help"}>
        <legend className="font-semibold mb-4">
          <span className="review-help-label">
            Does your team still need this software?
            <FieldHelp
              id={formId + "-response-help"}
              {...reviewHelp.response}
            />
          </span>
        </legend>
        <div className="review-options">
          {(
            [
              [
                "still_needed",
                "Still Needed",
                "We rely on this software.",
                CheckCircle2,
              ],
              ["not_needed", "Not Needed", "We can stop using it.", XCircle],
              ["unsure", "Unsure", "Let's discuss with Finance.", CircleHelp],
            ] as const
          ).map(([value, label, text, Icon]) => (
            <label key={value}>
              <input type="radio" name="response" value={value} required />
              <Icon size={24} />
              <strong>{label}</strong>
              <span>{text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="editor-field">
        <div className="editor-field-label">
          <label htmlFor={formId + "-comment"}>Comment (optional)</label>
          <FieldHelp id={formId + "-comment-help"} {...reviewHelp.comment} />
        </div>
        <textarea
          id={formId + "-comment"}
          aria-describedby={formId + "-comment-help"}
          name="comment"
          rows={4}
          maxLength={3000}
          placeholder="Add context to help Finance make a decision."
        />
      </div>
      <Feedback result={result} />
      <Button disabled={pending}>
        {pending ? "Submitting…" : "Submit usage confirmation"}
      </Button>
      <p className="field-hint">
        Your response is shared with Finance. It does not cancel your
        subscription with the vendor.
      </p>
    </form>
  );
}

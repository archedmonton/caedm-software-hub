"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { respondReview, type Result } from "@/app/(hub)/actions";
import { Feedback } from "@/components/hub/controls";
import { Button } from "@/components/ui/button";
export function ReviewForm({ id }: { id: string }) {
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
      <fieldset>
        <legend className="font-semibold mb-4">
          Does your team still need this software?
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
      <label>
        Comment (optional)
        <textarea
          name="comment"
          rows={4}
          maxLength={3000}
          placeholder="Add context to help Finance make a decision."
        />
      </label>
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

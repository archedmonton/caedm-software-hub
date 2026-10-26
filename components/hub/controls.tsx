"use client";
import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  adminChange,
  addReference,
  changeStatus,
  requestReview,
  triggerReminders,
  type Result,
} from "@/app/(hub)/actions";
export function Feedback({ result }: { result: Result }) {
  return result.error ? (
    <p className="notice error" role="alert">
      {result.error}
    </p>
  ) : result.success ? (
    <p className="notice" role="status">
      {result.success}
    </p>
  ) : null;
}
export function ActionButton({
  action,
  id,
  children,
}: {
  action: "archived" | "cancelled" | "review" | "reminders";
  id?: string;
  children: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>({});
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirm]);
  const router = useRouter();
  const run = () =>
    start(async () => {
      const outcome =
        action === "reminders"
          ? await triggerReminders()
          : action === "review"
            ? await requestReview(id!)
            : await changeStatus(id!, action);
      setResult(outcome);
      setConfirm(false);
      if (outcome.success) router.refresh();
    });
  return (
    <div>
      <Button
        variant={
          action === "archived" || action === "cancelled"
            ? "outline"
            : "secondary"
        }
        disabled={pending}
        onClick={() => setConfirm(true)}
      >
        {pending ? "Working…" : children}
      </Button>
      {confirm && (
        <dialog
          ref={dialog}
          onCancel={() => setConfirm(false)}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`confirm-${action}`}
          className="modal-card"
        >
          <h2 id={`confirm-${action}`}>
            Confirm{" "}
            {action === "reminders"
              ? "reminder run"
              : action === "review"
                ? "usage review request"
                : action === "archived"
                  ? "archive"
                  : "cancellation"}
          </h2>
          <p className="my-5 text-muted-foreground">
            {action === "cancelled"
              ? "This updates your internal record. Complete cancellation with the vendor separately. Historical expenses are retained."
              : action === "archived"
                ? "This removes the record from active projections. Historical information is retained."
                : action === "review"
                  ? "A review will be assigned to the responsible owner. Existing requests for this renewal are kept."
                  : "This creates due reviews and delivers pending notifications using your configured email provider."}
          </p>
          <div className="flex gap-3">
            <Button
              autoFocus
              disabled={pending}
              variant="outline"
              onClick={() => setConfirm(false)}
            >
              Go back
            </Button>
            <Button disabled={pending} onClick={run}>
              Confirm
            </Button>
          </div>
        </dialog>
      )}
      <Feedback result={result} />
    </div>
  );
}
export function SimpleForm({
  kind,
  children,
  reference = false,
  confirm = false,
  label = "Save changes",
}: {
  kind: string;
  children: React.ReactNode;
  reference?: boolean;
  confirm?: boolean;
  label?: string;
}) {
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(
          new FormData(e.currentTarget),
        ) as Record<string, string>;
        if (confirm && !window.confirm("Confirm this access change?")) return;
        start(async () => {
          const outcome = reference
            ? await addReference(kind, data)
            : await adminChange(kind, data);
          setResult(outcome);
          if (outcome.success) router.refresh();
        });
      }}
    >
      {children}
      <Feedback result={result} />
      <Button disabled={pending}>{pending ? "Saving…" : label}</Button>
    </form>
  );
}

"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { X, Plus, MailPlus, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHelp } from "@/components/hub/field-help";
import { InviteEmployeeForm } from "@/components/hub/invitation-form";
import { SubmissionError } from "@/components/hub/submission-error";
import {
  createSoftwareReference,
  assignSoftwareEmployee,
} from "@/app/(hub)/software/reference-actions";
import type { Team } from "@/lib/domain";
import {
  referenceNameKey,
  duplicateReferenceMessage,
  type ReferenceKind,
  type ReferenceResult,
  type EditorEmployee,
} from "@/lib/software-reference";

export type EditorDialogKind = ReferenceKind | "employee";
const titles: Record<EditorDialogKind, string> = {
  vendor: "Add vendor",
  category: "Add category",
  department: "Add department",
  payment: "Add payment reference",
  employee: "Add responsible employee",
};
export function SoftwareReferenceDialog({
  kind,
  team,
  candidates,
  existingNames,
  onClose,
  onCreated,
  onEmployee,
}: {
  kind: EditorDialogKind;
  team?: Team;
  candidates: EditorEmployee[];
  existingNames: string[];
  onClose: () => void;
  onCreated: (kind: ReferenceKind, result: ReferenceResult) => void;
  onEmployee: (employee: EditorEmployee, canManage: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [error, setError] = useState<{
    message: string;
    field?: string;
    attempt: number;
  } | null>(null);
  const attempt = useRef(0);
  const reportError = (message: string, field?: string) =>
    setError({ message, field, attempt: ++attempt.current });
  const [employeeMode, setEmployeeMode] = useState<"existing" | "invite">(
    "existing",
  );
  const [pending, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  const busy = pending || inviting;
  useEffect(() => {
    if (error?.field && !busy)
      dialog.current
        ?.querySelector<HTMLElement>(`[name="${error.field}"]`)
        ?.focus();
  }, [error, busy]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>("input,select,textarea")?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  const employee = kind === "employee";
  return (
    <dialog
      ref={dialog}
      className="reference-dialog"
      aria-labelledby={id + "-title"}
      aria-describedby={id + "-description"}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="reference-dialog-header">
        <div>
          <span className="eyebrow">SOFTWARE DETAILS</span>
          <h2 id={id + "-title"}>{titles[kind]}</h2>
        </div>
        <button
          type="button"
          className="help-close"
          aria-label="Close reference dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="reference-dialog-body">
        <p id={id + "-description"} className="reference-dialog-description">
          {employee
            ? `Choose how to add someone to ${team?.name || "this department"}. Your software draft will stay here.`
            : kind === "payment"
              ? `Save a limited payment reference for ${team?.name || "this department"}. It will be selected in your software draft.`
              : "Save this shared reference and select it in your software draft. Your other entries will stay here."}
        </p>
        {employee && (
          <div
            className="employee-mode"
            role="group"
            aria-label="How to add an employee"
          >
            <button
              type="button"
              aria-pressed={employeeMode === "existing"}
              disabled={busy}
              onClick={() => {
                setEmployeeMode("existing");
                setError(null);
              }}
            >
              <UserRoundPlus size={16} aria-hidden="true" />
              Existing employee
            </button>
            <button
              type="button"
              aria-pressed={employeeMode === "invite"}
              disabled={busy}
              onClick={() => {
                setEmployeeMode("invite");
                setError(null);
              }}
            >
              <MailPlus size={16} aria-hidden="true" />
              Invite new employee
            </button>
          </div>
        )}
        {employee && employeeMode === "invite" ? (
          <>
            <p className="notice mb-5">
              New employees must accept their email invitation and set a
              password before they can be selected as responsible owners. You
              can save this software with an unassigned owner and return later.
            </p>
            <InviteEmployeeForm
              teams={team ? [team] : []}
              defaultTeamId={team?.id}
              staffOnly
              onPendingChange={setInviting}
            />
            <div className="reference-dialog-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                Back to software
              </Button>
            </div>
          </>
        ) : (
          <form
            className="reference-create-form"
            onChange={() => setError(null)}
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setError(null);
              const values = Object.fromEntries(new FormData(e.currentTarget));
              const nameField = kind === "payment" ? "nickname" : "name";
              if (
                !employee &&
                existingNames.some(
                  (name) =>
                    referenceNameKey(name) ===
                    referenceNameKey(String(values[nameField] || "")),
                )
              ) {
                reportError(duplicateReferenceMessage(kind), nameField);
                return;
              }
              start(async () => {
                try {
                  if (employee) {
                    const result = await assignSoftwareEmployee({
                      ...values,
                      team_id: team?.id,
                    });
                    if (result.error) {
                      reportError(result.error, "profile_id");
                      return;
                    }
                    if (result.employee) {
                      onEmployee(result.employee, result.can_manage ?? false);
                      onClose();
                    }
                  } else {
                    const result = await createSoftwareReference(kind, {
                      ...values,
                      ...(kind === "payment" ? { team_id: team?.id } : {}),
                    });
                    if (result.error) {
                      reportError(result.error, result.field);
                      return;
                    }
                    onCreated(kind, result);
                    onClose();
                  }
                } catch {
                  reportError(
                    "The save could not be confirmed. Your entries are still here. Check your connection before retrying.",
                  );
                }
              });
            }}
          >
            <fieldset disabled={pending} className="reference-create-fields">
              {employee ? (
                <>
                  <label>
                    Active employee
                    <select
                      name="profile_id"
                      required
                      defaultValue=""
                      aria-invalid={error?.field === "profile_id"}
                      aria-describedby={
                        error?.field === "profile_id"
                          ? id + "-error"
                          : undefined
                      }
                    >
                      <option value="" disabled>
                        Select an employee
                      </option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name} · {p.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field-hint">
                    This immediately grants View access to the selected
                    department and selects the employee as software owner.
                    Existing Manage permission is preserved. Pending, unverified
                    and protected accounts are not offered.
                  </p>
                  {!candidates.length && (
                    <p className="notice">
                      No eligible employees need membership in this department.
                      Choose an existing department member in the software form,
                      or invite a new employee.
                    </p>
                  )}
                </>
              ) : kind === "payment" ? (
                <>
                  <p className="reference-department">
                    <strong>Department</strong>
                    <span>{team?.name}</span>
                  </p>
                  <label>
                    Reference nickname
                    <input
                      name="nickname"
                      aria-invalid={error?.field === "nickname"}
                      aria-describedby={
                        error?.field === "nickname" ? id + "-error" : undefined
                      }
                      required
                      maxLength={100}
                      placeholder="For example, Department purchasing card"
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Card brand (optional)
                      <input
                        name="brand"
                        maxLength={40}
                        placeholder="For example, Visa"
                      />
                    </label>
                    <div className="editor-field">
                      <div className="editor-field-label">
                        <label htmlFor={id + "-last-four"}>
                          Last four digits (optional)
                        </label>
                        <FieldHelp
                          id={id + "-digits-help"}
                          title="Last four digits"
                          text="Enter only the last four card digits. Leave blank for a non-card reference. Never store a full card number, CVV, banking credentials or passwords."
                        />
                      </div>
                      <input
                        id={id + "-last-four"}
                        name="last_four"
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        autoComplete="off"
                        aria-describedby={id + "-digits-help"}
                      />
                    </div>
                  </div>
                  <label>
                    Payment notes (optional)
                    <textarea name="notes" maxLength={2000} rows={2} />
                  </label>
                  <p className="field-hint">
                    References only. Never enter full card numbers, security
                    codes, bank credentials or passwords.
                  </p>
                </>
              ) : (
                <label>
                  {kind === "vendor"
                    ? "Vendor name"
                    : kind === "category"
                      ? "Category name"
                      : "Department name"}
                  <input
                    name="name"
                    aria-invalid={error?.field === "name"}
                    aria-describedby={
                      error?.field === "name" ? id + "-error" : undefined
                    }
                    required
                    maxLength={
                      kind === "vendor" ? 150 : kind === "category" ? 80 : 100
                    }
                    autoComplete="off"
                  />
                </label>
              )}
            </fieldset>
            {error && (
              <SubmissionError
                key={error.attempt}
                id={id + "-error"}
                message={error.message}
              />
            )}
            <div className="reference-dialog-actions">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button disabled={pending || (employee && !candidates.length)}>
                <Plus size={16} aria-hidden="true" />
                {pending
                  ? "Saving…"
                  : employee
                    ? "Add employee and select"
                    : kind === "payment"
                      ? "Save payment reference"
                      : `Save ${kind}`}
              </Button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

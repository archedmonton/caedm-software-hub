"use client";
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmissionError } from "@/components/hub/submission-error";
import {
  inviteEmployee,
  manageInvitation,
  type InvitationState,
} from "@/app/invitations/actions";
import type { Team } from "@/lib/domain";

export function InviteEmployeeForm({
  teams,
  defaultTeamId = "",
  staffOnly = false,
  onPendingChange,
}: {
  teams: Team[];
  defaultTeamId?: string;
  staffOnly?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const id = useId();
  const emailInput = useRef<HTMLInputElement>(null);
  const [edited, setEdited] = useState(false);
  const defaults = {
    full_name: "",
    email: "",
    team_id: defaultTeamId,
    role: "staff",
    can_manage: "false",
  };
  const [values, setValues] = useState(defaults);
  const changeField = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;
    setEdited(true);
    setValues((previous) => ({ ...previous, [name]: value }));
  };
  const [state, action, pending] = useActionState<InvitationState, FormData>(
    async (previous, form) => {
      const outcome = await inviteEmployee(previous, form);
      if (outcome.success) setValues(defaults);
      return outcome;
    },
    {},
  );
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  useEffect(() => {
    if (state.field === "email" && !pending) emailInput.current?.focus();
  }, [state, pending]);
  const showError = !pending && !edited && Boolean(state.error);
  return (
    <form
      action={action}
      className="invitation-form"
      onSubmit={() => setEdited(false)}
    >
      <div className="form-grid">
        <label>
          Employee name
          <input
            name="full_name"
            value={values.full_name}
            onChange={changeField}
            required
            maxLength={150}
            autoComplete="name"
          />
        </label>
        <label>
          Employee work email
          <input
            name="email"
            value={values.email}
            onChange={changeField}
            ref={emailInput}
            aria-invalid={showError && state.field === "email"}
            aria-describedby={
              showError && state.field === "email" ? id + "-error" : undefined
            }
            type="email"
            required
            maxLength={254}
            placeholder="employee@caedm.ca"
            autoComplete="email"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Invitation department
          <select
            name="team_id"
            required
            value={values.team_id}
            onChange={changeField}
          >
            <option value="" disabled>
              Select a department
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {!staffOnly && (
          <label>
            Invitation role
            <select name="role" value={values.role} onChange={changeField}>
              <option value="staff">Staff</option>
              <option value="finance">Finance</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
        )}
      </div>
      {staffOnly && <input type="hidden" name="role" value="staff" />}
      <label>
        Department software permissions
        <select
          name="can_manage"
          value={values.can_manage}
          onChange={changeField}
        >
          <option value="false">View department software</option>
          <option value="true">View and manage department software</option>
        </select>
      </label>
      <p className="field-hint">
        {staffOnly ? (
          "This employee will be invited as Staff with the selected department permission. They receive a secure email and create their own password."
        ) : (
          <>
            Staff access is limited to assigned departments. Finance and
            Administrator roles have organization-wide access. The employee
            receives a secure email and creates their own password.
          </>
        )}
      </p>
      {!teams.length && (
        <p className="notice">
          Create a department before sending an invitation.
        </p>
      )}
      {showError && (
        <SubmissionError id={id + "-error"} message={state.error!} />
      )}
      {state.success && (
        <p className="notice" role="status">
          {state.success}
        </p>
      )}
      <div className="invitation-form-actions">
        <Button disabled={pending || !teams.length}>
          <MailPlus size={16} />
          {pending ? "Sending invitation..." : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}
export function InvitationControls({ id }: { id: string }) {
  const [state, setState] = useState<InvitationState>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (action: "resend" | "revoke") => {
    if (
      action === "revoke" &&
      !window.confirm(
        "Revoke this invitation? Its link will no longer grant access.",
      )
    )
      return;
    start(async () => {
      const outcome = await manageInvitation(id, action);
      setState(outcome);
      router.refresh();
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run("resend")}
        >
          Resend invitation
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run("revoke")}
        >
          Revoke invitation
        </Button>
      </div>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice" role="status">
          {state.success}
        </p>
      )}
    </div>
  );
}

"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  inviteEmployee,
  manageInvitation,
  type InvitationState,
} from "@/app/invitations/actions";
import type { Team } from "@/lib/domain";

export function InviteEmployeeForm({ teams }: { teams: Team[] }) {
  const [state, action, pending] = useActionState<InvitationState, FormData>(
    inviteEmployee,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <label>
        Employee name
        <input name="full_name" required maxLength={150} autoComplete="name" />
      </label>
      <label>
        Employee work email
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          placeholder="employee@caedm.ca"
          autoComplete="email"
        />
      </label>
      <div className="form-grid">
        <label>
          Invitation department
          <select name="team_id" required defaultValue="">
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
        <label>
          Invitation role
          <select name="role" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="finance">Finance</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
      </div>
      <label>
        Department software permissions
        <select name="can_manage" defaultValue="false">
          <option value="false">View department software</option>
          <option value="true">View and manage department software</option>
        </select>
      </label>
      <p className="field-hint">
        Staff access is limited to assigned departments. Finance and
        Administrator roles have organization-wide access. The employee receives
        a secure email and creates their own password.
      </p>
      {!teams.length && (
        <p className="notice">
          Create a department before sending an invitation.
        </p>
      )}
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
      <Button disabled={pending || !teams.length}>
        <MailPlus size={16} />
        {pending ? "Sending invitation..." : "Send invitation"}
      </Button>
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

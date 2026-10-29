import { requireAccess } from "@/lib/auth";
import { allRows } from "@/lib/data";
import { roles, roleLabels, type Profile, type Team } from "@/lib/domain";
import { canManageAccount } from "@/lib/account-permissions";
import { PageHeading, Status } from "@/components/hub/common";
import { SimpleForm } from "@/components/hub/controls";
import {
  InviteEmployeeForm,
  InvitationControls,
} from "@/components/hub/invitation-form";
import { employeeInvitations } from "@/lib/invitations";
export default async function TeamPage() {
  const { db, profile } = await requireAccess("admin");
  const [people, teams, members, invitations, protection] = await Promise.all([
    allRows<Profile>(db, "profiles"),
    allRows<Team>(db, "teams"),
    allRows<{ team_id: string; profile_id: string; can_manage: boolean }>(
      db,
      "team_members",
    ),
    employeeInvitations(db),
    db.rpc("get_developer_protection"),
  ]);
  const protectedDeveloperId = protection.data as string | null;
  const editable = (person: Profile) =>
    !protection.error &&
    canManageAccount(profile, person, protectedDeveloperId);
  const assignableRoles = roles.filter(
    (role) => role !== "super_admin" || profile.role === "super_admin",
  );
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="People & departments"
        description="Give each person the right access and a clear place in the team."
      />
      <div className="notice mb-6">
        {profile.role === "super_admin"
          ? "You can grant or revoke Super Admin access for other verified, active employees. The protected developer account cannot be demoted, suspended or removed."
          : "Admins manage ordinary employee access. Only Super Admins can grant or change Super Admin access; protected accounts are read-only here."}
        {protection.error &&
          " Access management is temporarily unavailable. Contact the developer."}
      </div>
      <section className="panel invitation-panel mb-6">
        <h2 className="mb-3">Invite an employee</h2>
        <p className="text-muted-foreground mb-5">
          Select their access and send a professional invitation. No account
          access is granted until they set their password.
        </p>
        <InviteEmployeeForm teams={teams} />
      </section>
      <div className="admin-grid">
        <section className="panel p-6">
          <h2 className="mb-5">Create a department</h2>
          <SimpleForm kind="team" label="Create department">
            <label>
              Department name
              <input name="name" required maxLength={100} />
            </label>
          </SimpleForm>
        </section>
        <section className="panel p-6">
          <h2 className="mb-5">Assign department access</h2>
          <SimpleForm kind="member" label="Assign membership" confirm>
            <label>
              Employee
              <select name="profile_id" required>
                {people.filter(editable).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} · {p.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Department
              <select name="team_id" required>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Software permissions
              <select name="can_manage">
                <option value="false">View team software</option>
                <option value="true">View and manage team software</option>
              </select>
            </label>
            <p className="field-hint">
              Assign software owners or transfer ownership from the software
              edit form.
            </p>
          </SimpleForm>
        </section>
      </div>
      <section className="panel mt-6" aria-labelledby="invitations-heading">
        <div className="panel-heading">
          <div>
            <h2 id="invitations-heading">Employee invitations</h2>
            <p>
              Links expire after 72 hours. Resending invalidates the previous
              link.
            </p>
          </div>
          <span className="count-chip">{invitations.length}</span>
        </div>
        {!invitations.length ? (
          <p className="p-6 text-muted-foreground">No invitations yet.</p>
        ) : (
          <div className="people-list">
            {invitations
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((i) => {
                const expired = i.expired;
                const label =
                  i.status === "accepted"
                    ? "Accepted"
                    : i.status === "revoked"
                      ? "Revoked"
                      : expired
                        ? "Expired"
                        : i.delivery_status === "failed"
                          ? "Delivery failed"
                          : i.delivery_status === "sending"
                            ? "Sending"
                            : "Pending invitation";
                return (
                  <article key={i.id}>
                    <div>
                      <h3>{i.full_name}</h3>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {i.email}
                      </p>
                      <span className="status">{label}</span>
                      <p className="field-hint mt-3">
                        {teams.find((t) => t.id === i.team_id)?.name} |{" "}
                        {roleLabels[i.role]}
                      </p>
                      <p className="field-hint">
                        Expires{" "}
                        {new Intl.DateTimeFormat("en-CA", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "America/Edmonton",
                        }).format(new Date(i.expires_at))}{" "}
                        (Edmonton)
                      </p>
                      {i.delivery_error && (
                        <p className="notice error mt-3">{i.delivery_error}</p>
                      )}
                    </div>
                    {i.status === "pending" && <InvitationControls id={i.id} />}
                  </article>
                );
              })}
          </div>
        )}
      </section>
      <section className="panel mt-6">
        <div className="panel-heading">
          <div>
            <h2>Registered accounts</h2>
            <p>
              Approval requires a verified CAEDM email. Role metadata submitted
              at signup is ignored.
            </p>
          </div>
          <span className="count-chip">{people.length}</span>
        </div>
        <div className="people-list">
          {people
            .sort((a, b) =>
              a.status === "pending_approval"
                ? -1
                : b.status === "pending_approval"
                  ? 1
                  : a.full_name.localeCompare(b.full_name),
            )
            .map((p) => (
              <article key={p.id}>
                <div>
                  <h3>{p.full_name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 mb-3">
                    {p.email}
                  </p>
                  <Status value={p.status} />
                  <span className="status ml-2">{roleLabels[p.role]}</span>
                  {p.id === protectedDeveloperId && (
                    <p className="field-hint mt-3">
                      Protected developer Super Admin
                    </p>
                  )}
                  <p className="field-hint mt-3">
                    {members
                      .filter((m) => m.profile_id === p.id)
                      .map(
                        (m) =>
                          `${teams.find((t) => t.id === m.team_id)?.name}${m.can_manage ? " (manage)" : " (view)"}`,
                      )
                      .join(" · ") || "No department assigned"}
                  </p>
                </div>
                {editable(p) && p.id !== protectedDeveloperId ? (
                  <SimpleForm kind="profile" confirm label="Update access">
                    <input type="hidden" name="id" value={p.id} />
                    <div className="flex gap-3 flex-wrap">
                      <label>
                        Role
                        <select name="role" defaultValue={p.role}>
                          {assignableRoles
                            .filter(
                              (r) =>
                                r !== "super_admin" ||
                                p.status === "active" ||
                                p.role === "super_admin",
                            )
                            .map((r) => (
                              <option key={r} value={r}>
                                {roleLabels[r]}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Status
                        <select name="status" defaultValue={p.status}>
                          {[
                            "pending_approval",
                            "active",
                            "rejected",
                            "suspended",
                            "deactivated",
                          ].map((s) => (
                            <option key={s} value={s}>
                              {s.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </SimpleForm>
                ) : (
                  <p className="field-hint">
                    {p.id === protectedDeveloperId
                      ? "Developer access is protected and must remain active."
                      : "Only a Super Admin can change this account's access."}
                  </p>
                )}
                {members
                  .filter((m) => m.profile_id === p.id && editable(p))
                  .map((m) => (
                    <div key={m.team_id} className="mt-3">
                      <SimpleForm
                        kind="remove_member"
                        confirm
                        label={`Remove ${teams.find((t) => t.id === m.team_id)?.name || "department"} access`}
                      >
                        <input type="hidden" name="team_id" value={m.team_id} />
                        <input type="hidden" name="profile_id" value={p.id} />
                      </SimpleForm>
                    </div>
                  ))}
              </article>
            ))}
        </div>
      </section>
    </>
  );
}

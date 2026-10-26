import { requireAccess } from "@/lib/auth";
import { allRows } from "@/lib/data";
import { roles, type Profile, type Team } from "@/lib/domain";
import { PageHeading, Status } from "@/components/hub/common";
import { SimpleForm } from "@/components/hub/controls";
export default async function TeamPage() {
  const { db } = await requireAccess("admin");
  const [people, teams, members] = await Promise.all([
    allRows<Profile>(db, "profiles"),
    allRows<Team>(db, "teams"),
    allRows<{ team_id: string; profile_id: string; can_manage: boolean }>(
      db,
      "team_members",
    ),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="People & departments"
        description="Give each person the right access and a clear place in the team."
      />
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
                {people.map((p) => (
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
                <SimpleForm kind="profile" confirm label="Update access">
                  <input type="hidden" name="id" value={p.id} />
                  <div className="flex gap-3 flex-wrap">
                    <label>
                      Role
                      <select name="role" defaultValue={p.role}>
                        {roles.map((r) => (
                          <option key={r}>{r}</option>
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
                {members
                  .filter((m) => m.profile_id === p.id)
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

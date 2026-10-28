import { beforeAll, beforeEach, afterAll, test, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
let db;
const team = "10000000-0000-4000-8000-000000000001";
const digest = () => randomBytes(32).toString("hex");
beforeAll(async () => {
  db = await database();
  await fixtures(db);
}, 60000);
beforeEach(async () => {
  await db.exec(
    "delete from private.rate_limits where key like 'employee-invites:%'",
  );
});
afterAll(async () => {
  await db?.close();
});
async function service(sql, params = []) {
  await db.exec("set role service_role");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function invite(options = {}) {
  const hash = digest();
  const email = options.email || "invite-" + randomUUID() + "@caedm.ca";
  const result = await asUser(db, ids.admin, () =>
    db.query(
      "select public.prepare_employee_invitation($1,$2,$3,$4,$5,$6) as invitation",
      [
        hash,
        "Invited Employee",
        email,
        options.team || team,
        options.role || "staff",
        options.manage || false,
      ],
    ),
  );
  return { ...result.rows[0].invitation, hash };
}
async function claim(i) {
  const result = await service(
    "select public.claim_employee_invitation($1) as claimed",
    [i.hash],
  );
  return result.rows[0].claimed;
}
async function createInvitedUser(
  i,
  verified = true,
  password = "password-hash",
) {
  const id = (
    await db.query(
      "select onboarding_user_id from employee_invitations where id=$1",
      [i.id],
    )
  ).rows[0].onboarding_user_id;
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,$3,$4)",
    [id, i.email, verified ? new Date().toISOString() : null, password],
  );
  await db.query("update auth.users set raw_app_meta_data=$2 where id=$1", [
    id,
    JSON.stringify({ caedm_invitation_id: i.id }),
  ]);
  return id;
}

test("only verified active administrators can prepare invitations", async () => {
  for (const id of [ids.staff, ids.finance, ids.pending, ids.unverified])
    await asUser(db, id, async () => {
      await expect(
        db.query("select public.prepare_employee_invitation($1,'Name',$2,$3)", [
          digest(),
          "blocked-" + randomUUID() + "@caedm.ca",
          team,
        ]),
      ).rejects.toThrow("Administrator");
    });
  await db.exec("set role anon");
  try {
    await expect(
      db.query("select public.prepare_employee_invitation($1)", [digest()]),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
test("rejects external domains, nonexistent departments and existing accounts", async () => {
  await expect(invite({ email: "someone@caedm.ca.evil.test" })).rejects.toThrow(
    "valid @caedm.ca",
  );
  await expect(invite({ team: randomUUID() })).rejects.toThrow(
    "existing department",
  );
  await expect(invite({ email: "staff@caedm.ca" })).rejects.toThrow(
    "already has an account",
  );
});
test("invitations are visible only to admins; token hashes and claims are not client readable", async () => {
  const i = await invite();
  await asUser(db, ids.staff, async () => {
    expect(
      (await db.query("select id,email from employee_invitations")).rows,
    ).toHaveLength(0);
  });
  await asUser(db, ids.admin, async () => {
    expect(
      (
        await db.query(
          "select id,email from employee_invitations where id=$1",
          [i.id],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      db.query("select token_hash from employee_invitations"),
    ).rejects.toThrow();
    await expect(
      db.query("update employee_invitations set role='admin' where id=$1", [
        i.id,
      ]),
    ).rejects.toThrow();
  });
  await expect(invite({ email: i.email })).rejects.toThrow("already exists");
});
test("all acceptance and delivery RPCs reject authenticated clients", async () => {
  await asUser(db, ids.staff, async () => {
    await expect(
      db.query("select public.claim_employee_invitation($1)", [digest()]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.complete_employee_invitation($1,$2,$3)", [
        randomUUID(),
        randomUUID(),
        ids.staff,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.finish_invitation_delivery($1,$2,true)", [
        randomUUID(),
        digest(),
      ]),
    ).rejects.toThrow();
  });
});
test("signup metadata cannot replace invitation acceptance", async () => {
  const i = await invite();
  await expect(
    db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)",
      [
        randomUUID(),
        i.email,
        JSON.stringify({ caedm_invitation_id: i.id, role: "admin" }),
      ],
    ),
  ).rejects.toThrow("administrator invitation");
});
test("claims serialize password setup and cannot be released with another claim", async () => {
  const i = await invite();
  const c = await claim(i);
  await expect(claim(i)).rejects.toThrow("already in progress");
  await service("select public.release_employee_invitation($1,$2)", [
    i.id,
    randomUUID(),
  ]);
  await expect(claim(i)).rejects.toThrow("already in progress");
  await service("select public.release_employee_invitation($1,$2)", [
    i.id,
    c.claim,
  ]);
  expect((await claim(i)).id).toBe(i.id);
});
test("verified password setup activates exactly the invited role and membership once", async () => {
  const i = await invite({ manage: true });
  const c = await claim(i);
  const user = await createInvitedUser(i);
  await expect(
    service("select public.complete_employee_invitation($1,$2,$3)", [
      i.id,
      null,
      user,
    ]),
  ).rejects.toThrow();
  await asUser(db, ids.admin, async () => {
    await expect(
      db.query("update profiles set status='active' where id=$1", [user]),
    ).rejects.toThrow("password setup");
  });
  await service("select public.complete_employee_invitation($1,$2,$3)", [
    i.id,
    c.claim,
    user,
  ]);
  expect(
    (await db.query("select role,status from profiles where id=$1", [user]))
      .rows[0],
  ).toEqual({ role: "staff", status: "active" });
  expect(
    (
      await db.query(
        "select team_id,can_manage from team_members where profile_id=$1",
        [user],
      )
    ).rows,
  ).toEqual([{ team_id: team, can_manage: true }]);
  await expect(
    service("select public.complete_employee_invitation($1,$2,$3)", [
      i.id,
      c.claim,
      user,
    ]),
  ).rejects.toThrow();
  await expect(claim(i)).rejects.toThrow();
});
test("unverified users and missing passwords cannot complete invitations", async () => {
  const i = await invite();
  const c = await claim(i);
  const user = await createInvitedUser(i, false, "");
  await expect(
    service("select public.complete_employee_invitation($1,$2,$3)", [
      i.id,
      c.claim,
      user,
    ]),
  ).rejects.toThrow("incomplete");
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    user,
  ]);
  await expect(
    service("select public.complete_employee_invitation($1,$2,$3)", [
      i.id,
      c.claim,
      user,
    ]),
  ).rejects.toThrow("incomplete");
  expect(
    (await db.query("select status from profiles where id=$1", [user])).rows[0]
      .status,
  ).toBe("pending_approval");
});
test("revocation during acceptance prevents activation and replay", async () => {
  const i = await invite();
  const c = await claim(i);
  const user = await createInvitedUser(i);
  await asUser(db, ids.admin, () =>
    db.query("select public.revoke_employee_invitation($1)", [i.id]),
  );
  await expect(
    service("select public.complete_employee_invitation($1,$2,$3)", [
      i.id,
      c.claim,
      user,
    ]),
  ).rejects.toThrow();
  expect(
    (await db.query("select status from profiles where id=$1", [user])).rows[0]
      .status,
  ).toBe("pending_approval");
  await expect(claim(i)).rejects.toThrow();
});
test("expired links fail and resend rotates the hash without changing role or department", async () => {
  const i = await invite({ role: "finance" });
  await db.query(
    "update employee_invitations set expires_at=now()-interval '1 day',last_sent_at=now()-interval '2 minutes' where id=$1",
    [i.id],
  );
  await expect(claim(i)).rejects.toThrow("expired");
  const hash = digest();
  await asUser(db, ids.admin, () =>
    db.query(
      "select public.prepare_employee_invitation($1,existing_invitation=>$2)",
      [hash, i.id],
    ),
  );
  await expect(claim(i)).rejects.toThrow();
  expect((await claim({ ...i, hash })).email).toBe(i.email);
  const row = (
    await db.query(
      "select role,team_id from employee_invitations where id=$1",
      [i.id],
    )
  ).rows[0];
  expect(row).toEqual({ role: "finance", team_id: team });
});
test("failed delivery remains recoverable, stale delivery updates cannot overwrite resend", async () => {
  const i = await invite();
  await service("select public.finish_invitation_delivery($1,$2,false)", [
    i.id,
    i.hash,
  ]);
  expect(
    (
      await db.query(
        "select delivery_status from employee_invitations where id=$1",
        [i.id],
      )
    ).rows[0].delivery_status,
  ).toBe("failed");
  await expect(
    asUser(db, ids.admin, () =>
      db.query(
        "select public.prepare_employee_invitation($1,existing_invitation=>$2)",
        [digest(), i.id],
      ),
    ),
  ).rejects.toThrow("one minute");
  await db.query(
    "update employee_invitations set last_sent_at=now()-interval '2 minutes' where id=$1",
    [i.id],
  );
  const hash = digest();
  await asUser(db, ids.admin, () =>
    db.query(
      "select public.prepare_employee_invitation($1,existing_invitation=>$2)",
      [hash, i.id],
    ),
  );
  await expect(
    service("select public.finish_invitation_delivery($1,$2,true)", [
      i.id,
      i.hash,
    ]),
  ).rejects.toThrow("changed or revoked");
  await service("select public.finish_invitation_delivery($1,$2,true)", [
    i.id,
    hash,
  ]);
});
test("partially created invite accounts can resume without adopting existing unrelated accounts", async () => {
  const i = await invite();
  const c = await claim(i);
  const user = await createInvitedUser(i);
  await service("select public.release_employee_invitation($1,$2)", [
    i.id,
    c.claim,
  ]);
  expect((await claim(i)).user_id).toBe(user);
  const other = await invite();
  const oc = await claim(other);
  const otherUser = await createInvitedUser(other);
  await service("select public.release_employee_invitation($1,$2)", [
    other.id,
    oc.claim,
  ]);
  await db.query("update auth.users set raw_app_meta_data='{}' where id=$1", [
    otherUser,
  ]);
  await expect(claim(other)).rejects.toThrow("already has an account");
});
test("email changes or deactivation of the inviting admin invalidate approval", async () => {
  const i = await invite();
  const c = await claim(i);
  const user = await createInvitedUser(i);
  await db.query(
    "update auth.users set email='changed-admin@caedm.ca' where id=$1",
    [ids.admin],
  );
  try {
    await expect(
      service("select public.complete_employee_invitation($1,$2,$3)", [
        i.id,
        c.claim,
        user,
      ]),
    ).rejects.toThrow("no longer valid");
  } finally {
    await db.query("update auth.users set email='admin@caedm.ca' where id=$1", [
      ids.admin,
    ]);
  }
});
test("invitation audit records exclude token hashes and acceptance claim secrets", async () => {
  const i = await invite();
  await claim(i);
  const rows = (
    await db.query(
      "select before_data,after_data from audit_logs where entity='employee_invitations' and record_id=$1",
      [i.id],
    )
  ).rows;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(JSON.stringify(row)).not.toContain(i.hash);
    expect(JSON.stringify(row)).not.toContain("accept_claim");
  }
});
test("administrator invitation rate limit prevents bulk email abuse", async () => {
  for (let n = 0; n < 20; n++) await invite();
  await expect(invite()).rejects.toThrow("limit reached");
});

test("additive upgrade preserves existing accounts, subscriptions, and department isolation", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { readFile, readdir } = await import("node:fs/promises");
  const baseline = new PGlite();
  try {
    const helper = await readFile("tests/db-helper.mjs", "utf8");
    await baseline.exec(helper.match(/await db\.exec\(\s*`([\s\S]*?)`/)[1]);
    const migrations = (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of migrations.filter((f) => f < "202610270001"))
      await baseline.exec(
        await readFile("supabase/migrations/" + file, "utf8"),
      );
    await fixtures(baseline);
    const before = (
      await baseline.query(
        "select count(*)::int as count from software_subscriptions",
      )
    ).rows[0].count;
    await baseline.exec(
      await readFile(
        "supabase/migrations/202610270001_employee_invitations.sql",
        "utf8",
      ),
    );
    expect(
      (
        await baseline.query(
          "select count(*)::int as count from software_subscriptions",
        )
      ).rows[0].count,
    ).toBe(before);
    expect(
      (
        await baseline.query("select role,status from profiles where id=$1", [
          ids.admin,
        ])
      ).rows[0],
    ).toEqual({ role: "admin", status: "active" });
    await asUser(baseline, ids.staff, async () => {
      expect(
        (
          await baseline.query(
            "select distinct team_id from software_subscriptions",
          )
        ).rows,
      ).toEqual([{ team_id: team }]);
    });
  } finally {
    await baseline.close();
  }
});

test("Auth Admin can insert before app metadata is applied, but activation still requires trusted metadata", async () => {
  const i = await invite();
  const c = await claim(i);
  await expect(
    db.query(
      "insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)",
      [randomUUID(), i.email, JSON.stringify({ caedm_invitation_id: i.id })],
    ),
  ).rejects.toThrow("administrator invitation");
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,now(),'password-hash')",
    [c.new_user_id, i.email],
  );
  await expect(
    service("select public.complete_employee_invitation($1,$2,$3)", [
      i.id,
      c.claim,
      c.new_user_id,
    ]),
  ).rejects.toThrow("incomplete");
  await db.query("update auth.users set raw_app_meta_data=$2 where id=$1", [
    c.new_user_id,
    JSON.stringify({ caedm_invitation_id: i.id }),
  ]);
  await service("select public.complete_employee_invitation($1,$2,$3)", [
    i.id,
    c.claim,
    c.new_user_id,
  ]);
  expect(
    (await db.query("select status from profiles where id=$1", [c.new_user_id]))
      .rows[0].status,
  ).toBe("active");
});

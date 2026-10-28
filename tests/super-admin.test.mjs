import { beforeAll, beforeEach, afterAll, test, expect } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
const root = "a1000000-0000-4000-8000-000000000001";
const delegated = "a1000000-0000-4000-8000-000000000002";
const department = "10000000-0000-4000-8000-000000000001";
const otherDepartment = "10000000-0000-4000-8000-000000000002";
let db;
async function createUser(target, id, email, verified = true) {
  await target.query(
    "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4)",
    [
      id,
      email,
      verified ? new Date().toISOString() : null,
      {
        full_name: "Test protected roles",
        role: "super_admin",
        status: "active",
      },
    ],
  );
}
beforeAll(async () => {
  db = await database();
  await fixtures(db);
  await createUser(db, root, "ruban.peppin@caedm.ca");
  await createUser(db, delegated, "test-super-admin@caedm.ca");
  await db.query("update profiles set status='active' where id in ($1,$2)", [
    root,
    delegated,
  ]);
  await db.exec("select private.bootstrap_developer_super_admin()");
  await db.query("update profiles set role='super_admin' where id=$1", [
    delegated,
  ]);
  await asUser(db, root, () =>
    db.exec(
      "insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference) select id,current_date,10,0.5,currency,'TEST-ROLE-PRESERVATION' from software_subscriptions order by id limit 1",
    ),
  );
}, 60000);
beforeEach(async () => {
  await db.exec("delete from private.rate_limits");
  await db.query(
    "update profiles set role='staff',status='active' where id in ($1,$2,$3,$4)",
    [delegated, ids.admin, ids.finance, ids.staff],
  );
  await db.query("update profiles set role='super_admin' where id=$1", [
    delegated,
  ]);
  await db.query("update profiles set role='admin' where id=$1", [ids.admin]);
  await db.query("update profiles set role='finance' where id=$1", [
    ids.finance,
  ]);
  await db.query(
    "insert into team_members(team_id,profile_id,can_manage) values($1,$2,false),($1,$3,false) on conflict(team_id,profile_id) do update set can_manage=false",
    [department, root, delegated],
  );
});
afterAll(async () => {
  await db?.close();
});
async function service(sql, values = []) {
  await db.exec("set role service_role");
  try {
    return await db.query(sql, values);
  } finally {
    await db.exec("reset role");
  }
}
test("bootstrap pins the existing verified developer UUID and preserves its active role", async () => {
  expect(
    (await db.query("select profile_id from private.developer_protection"))
      .rows,
  ).toEqual([{ profile_id: root }]);
  expect(
    (await db.query("select role,status from profiles where id=$1", [root]))
      .rows[0],
  ).toEqual({ role: "super_admin", status: "active" });
  expect(
    (await db.exec("select private.bootstrap_developer_super_admin()"))[0]
      .rows[0],
  ).toBeTruthy();
});
test("Admin cannot promote itself or another employee through direct SQL", async () => {
  for (const employee of [ids.admin, ids.finance, ids.staff])
    await asUser(db, ids.admin, async () => {
      await expect(
        db.query(
          "update profiles set role='super_admin' where id=$1 returning id",
          [employee],
        ),
      ).rejects.toThrow();
    });
  expect(
    (await db.query("select role from profiles where id=$1", [ids.admin]))
      .rows[0].role,
  ).toBe("admin");
});
test("Admin cannot edit Super Admin accounts, and delegated Super Admin cannot edit the developer", async () => {
  for (const [actor, employee] of [
    [ids.admin, root],
    [ids.admin, delegated],
    [delegated, root],
  ])
    await asUser(db, actor, async () => {
      expect(
        (
          await db.query(
            "update profiles set role='staff',status='suspended' where id=$1 returning id",
            [employee],
          )
        ).rows,
      ).toHaveLength(0);
    });
  expect(
    (await db.query("select role,status from profiles where id=$1", [root]))
      .rows[0],
  ).toEqual({ role: "super_admin", status: "active" });
});
test("Super Admin grants and revokes another verified active employee's elevated role with audit history", async () => {
  await asUser(db, root, async () => {
    await db.query("update profiles set role='super_admin' where id=$1", [
      ids.finance,
    ]);
    await db.query("update profiles set role='admin' where id=$1", [
      ids.finance,
    ]);
  });
  expect(
    (await db.query("select role from profiles where id=$1", [ids.finance]))
      .rows[0].role,
  ).toBe("admin");
  expect(
    (
      await db.query(
        "select id from audit_logs where entity='profiles' and actor_id=$1 and record_id=$2 and after_data->>'role'='super_admin'",
        [root, ids.finance],
      )
    ).rows.length,
  ).toBeGreaterThan(0);
});
test("pending and unverified accounts cannot receive Super Admin before approval", async () => {
  for (const employee of [ids.pending, ids.unverified])
    await asUser(db, root, async () => {
      await expect(
        db.query(
          "update profiles set role='super_admin',status='active' where id=$1",
          [employee],
        ),
      ).rejects.toThrow();
    });
});
test("the pinned developer cannot be demoted, restricted, re-identified or deleted even by an operator update", async () => {
  for (const changes of [
    "role='admin'",
    "status='deactivated'",
    "email='replacement@caedm.ca'",
    "id='a1000000-0000-4000-8000-000000000099'",
  ])
    await expect(
      db.query(`update profiles set ${changes} where id=$1`, [root]),
    ).rejects.toThrow();
  await expect(
    db.query("delete from profiles where id=$1", [root]),
  ).rejects.toThrow("protected");
});
test("clients cannot read or rewrite protection or invoke the operator-only bootstrap", async () => {
  for (const actor of [root, delegated, ids.admin, ids.staff])
    await asUser(db, actor, async () => {
      await expect(
        db.exec("select * from private.developer_protection"),
      ).rejects.toThrow();
      await expect(
        db.exec("delete from private.developer_protection"),
      ).rejects.toThrow();
      await expect(
        db.exec("select private.bootstrap_developer_super_admin()"),
      ).rejects.toThrow();
    });
  await expect(
    service("select private.bootstrap_developer_super_admin()"),
  ).rejects.toThrow();
  await asUser(db, ids.staff, async () => {
    await expect(
      db.exec("select get_developer_protection()"),
    ).rejects.toThrow();
  });
  await asUser(db, ids.admin, async () => {
    expect(
      (await db.query("select get_developer_protection() as id")).rows[0].id,
    ).toBe(root);
  });
});
test("protected memberships resist direct writes, target changes and membership RPC bypass", async () => {
  for (const [actor, employee] of [
    [ids.admin, root],
    [ids.admin, delegated],
    [delegated, root],
  ])
    await asUser(db, actor, async () => {
      expect(
        (
          await db.query(
            "update team_members set can_manage=true where profile_id=$1 returning profile_id",
            [employee],
          )
        ).rows,
      ).toHaveLength(0);
      await expect(
        db.query("insert into team_members(team_id,profile_id) values($1,$2)", [
          otherDepartment,
          employee,
        ]),
      ).rejects.toThrow();
      await expect(
        db.query("select remove_membership($1,$2)", [department, employee]),
      ).rejects.toThrow("protected");
      await expect(
        db.query("update team_members set profile_id=$1 where profile_id=$2", [
          employee,
          ids.staff,
        ]),
      ).rejects.toThrow();
    });
  await asUser(db, root, async () => {
    await db.query(
      "update team_members set can_manage=true where profile_id=$1",
      [delegated],
    );
    await db.query("select remove_membership($1,$2)", [department, delegated]);
  });
});
test("Super Admin retains organization-wide software, expense, settings and ordinary employee permissions", async () => {
  await asUser(db, root, async () => {
    expect(
      (await db.query("select id from software_subscriptions")).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (await db.query("select id from expense_records")).rows.length,
    ).toBeGreaterThan(0);
    await db.query(
      "update application_settings set organization_name='Role test' where id=true",
    );
    await db.query("update profiles set role='finance' where id=$1", [
      ids.staff,
    ]);
  });
});
test("Super Admin receives Finance response notifications and can invoke administrative reviews", async () => {
  const software = (
    await db.query(
      "select id from software_subscriptions where owner_id=$1 and next_billing_date is not null limit 1",
      [ids.staff],
    )
  ).rows[0].id;
  const review = await asUser(db, root, () =>
    db.query("select request_usage_review($1) as id", [software]),
  );
  await asUser(db, ids.staff, () =>
    db.query(
      "select respond_to_review($1,'still_needed','Role test response')",
      [review.rows[0].id],
    ),
  );
  expect(
    (
      await db.query(
        "select recipient_id from notification_logs where review_id=$1 and kind='response' and recipient_id=$2",
        [review.rows[0].id, root],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (await service("select * from claim_notifications()")).rows.some(
      (row) => row.email === "ruban.peppin@caedm.ca" && row.kind === "response",
    ),
  ).toBe(true);
});
test("a Super Admin invitation issuer can complete ordinary onboarding, but invitation roles cannot grant Super Admin", async () => {
  const hash = randomBytes(32).toString("hex"),
    email = `super-invited-${randomUUID()}@caedm.ca`;
  const prepared = await asUser(db, root, () =>
    db.query(
      "select prepare_employee_invitation($1,'Test invited employee',$2,$3,'staff',false) as result",
      [hash, email, department],
    ),
  );
  const invite = prepared.rows[0].result;
  const claim = (
    await service("select claim_employee_invitation($1) as result", [hash])
  ).rows[0].result;
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,encrypted_password,raw_app_meta_data) values($1,$2,now(),'test-password-hash',$3)",
    [claim.new_user_id, email, { caedm_invitation_id: invite.id }],
  );
  await service("select complete_employee_invitation($1,$2,$3)", [
    invite.id,
    claim.claim,
    claim.new_user_id,
  ]);
  expect(
    (
      await db.query("select role,status from profiles where id=$1", [
        claim.new_user_id,
      ])
    ).rows[0],
  ).toEqual({ role: "staff", status: "active" });
  await asUser(db, root, async () => {
    await expect(
      db.query(
        "select prepare_employee_invitation($1,'No highest role',$2,$3,'super_admin',false)",
        [
          randomBytes(32).toString("hex"),
          `blocked-${randomUUID()}@caedm.ca`,
          department,
        ],
      ),
    ).rejects.toThrow();
  });
});
test("signup matching the developer email does not self-assign access and bootstrap requires verification and approval", async () => {
  const fresh = await database();
  try {
    await createUser(fresh, root, "ruban.peppin@caedm.ca", false);
    expect(
      (
        await fresh.query("select role,status from profiles where id=$1", [
          root,
        ])
      ).rows[0],
    ).toEqual({ role: "staff", status: "pending_approval" });
    await expect(
      fresh.exec("select private.bootstrap_developer_super_admin()"),
    ).rejects.toThrow("verified");
    await fresh.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [root],
    );
    await expect(
      fresh.exec("select private.bootstrap_developer_super_admin()"),
    ).rejects.toThrow("active");
  } finally {
    await fresh.close();
  }
});
test("the last active Super Admin cannot be demoted or suspended on an unbootstrapped installation", async () => {
  const fresh = await database();
  try {
    await fixtures(fresh);
    await fresh.query("update profiles set role='super_admin' where id=$1", [
      ids.admin,
    ]);
    await expect(
      fresh.query("update profiles set role='admin' where id=$1", [ids.admin]),
    ).rejects.toThrow("Super Admin");
    await expect(
      fresh.query("update profiles set status='suspended' where id=$1", [
        ids.admin,
      ]),
    ).rejects.toThrow("Super Admin");
  } finally {
    await fresh.close();
  }
});
test("an additive upgrade pins the existing developer and preserves accounts and financial history", async () => {
  const prior = await database({ beforeVersion: "202610280003" });
  try {
    await fixtures(prior);
    await createUser(prior, root, "ruban.peppin@caedm.ca");
    await prior.query(
      "update profiles set role='admin',status='active' where id=$1",
      [root],
    );
    await asUser(prior, root, () =>
      prior.exec(
        "insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference) select id,current_date,10,0.5,currency,'TEST-UPGRADE-PRESERVATION' from software_subscriptions order by id limit 1",
      ),
    );
    const expenses = (
      await prior.query("select * from expense_records order by id")
    ).rows;
    const subscriptions = (
      await prior.query("select * from software_subscriptions order by id")
    ).rows;
    for (const name of [
      "202610280003_super_admin_role.sql",
      "202610280004_super_admin_permissions.sql",
    ])
      await prior.exec(await readFile("supabase/migrations/" + name, "utf8"));
    expect(
      (
        await prior.query("select role,status from profiles where id=$1", [
          root,
        ])
      ).rows[0],
    ).toEqual({ role: "super_admin", status: "active" });
    expect(
      (await prior.query("select * from expense_records order by id")).rows,
    ).toEqual(expenses);
    expect(
      (await prior.query("select * from software_subscriptions order by id"))
        .rows,
    ).toEqual(subscriptions);
    expect(
      (await prior.query("select role from profiles where id=$1", [ids.admin]))
        .rows[0].role,
    ).toBe("admin");
  } finally {
    await prior.close();
  }
});

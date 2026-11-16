import { beforeAll, afterAll, beforeEach, test, expect } from "vitest";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
let db;
beforeAll(async () => {
  db = await database();
  await fixtures(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "delete from private.account_email_notifications; delete from private.rate_limits",
  );
});
async function activeStatus() {
  await db.query(
    "update profiles set status='active',role='staff' where id=$1",
    [ids.staff],
  );
  await db.exec("delete from private.account_email_notifications");
}
test("verified approval updates enqueue one notice atomically; rolled-back and forbidden changes enqueue nothing", async () => {
  await asUser(db, ids.admin, () =>
    db.query("update profiles set status='active' where id=$1", [ids.pending]),
  );
  const rows = (
    await db.query("select * from private.account_email_notifications")
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    recipient_id: ids.pending,
    kind: "approval",
    status: "pending",
    actor_id: ids.admin,
  });
  await db.exec("begin");
  await db.query("update profiles set status='suspended' where id=$1", [
    ids.pending,
  ]);
  await db.exec("rollback");
  expect(
    (await db.query("select id from private.account_email_notifications")).rows,
  ).toHaveLength(1);
  await asUser(db, ids.staff, () =>
    db.query("update profiles set role='admin' where id=$1", [ids.staff]),
  );
  expect(
    (await db.query("select id from private.account_email_notifications")).rows,
  ).toHaveLength(1);
});
test("active employee role and access changes generate security-relevant snapshots, not duplicate no-op notices", async () => {
  await activeStatus();
  await asUser(db, ids.admin, () =>
    db.query("update profiles set role='finance' where id=$1", [ids.staff]),
  );
  await asUser(db, ids.admin, () =>
    db.query("update profiles set role='finance' where id=$1", [ids.staff]),
  );
  await asUser(db, ids.admin, () =>
    db.query("update profiles set status='suspended' where id=$1", [ids.staff]),
  );
  const rows = (
    await db.query(
      "select * from private.account_email_notifications order by created_at",
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.find((n) => n.kind === "role_changed")).toMatchObject({
    before_role: "staff",
    after_role: "finance",
  });
  expect(rows.find((n) => n.kind === "access_changed")).toMatchObject({
    after_status: "suspended",
  });
});
test("ordinary clients cannot discover, inject, claim or acknowledge operational notices", async () => {
  for (const actor of [ids.staff, ids.admin, ids.pending])
    await asUser(db, actor, async () => {
      await expect(
        db.query("select * from private.account_email_notifications"),
      ).rejects.toThrow();
      await expect(
        db.query("select * from claim_account_emails()"),
      ).rejects.toThrow();
      await expect(
        db.query(
          "select finish_account_email(gen_random_uuid(),gen_random_uuid(),true,'resend')",
        ),
      ).rejects.toThrow();
    });
  await db.exec("set role anon");
  try {
    await expect(
      db.query("select * from claim_account_emails()"),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
test("service-only leases prevent duplicate claims and stale acknowledgements; failed notices retry with a bound", async () => {
  await activeStatus();
  await db.query("update profiles set role='finance' where id=$1", [ids.staff]);
  await db.exec("set role service_role");
  let notice;
  try {
    notice = (await db.query("select * from claim_account_emails()")).rows[0];
    expect(notice.kind).toBe("role_changed");
    expect(
      (await db.query("select * from claim_account_emails()")).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select finish_account_email($1,gen_random_uuid(),true,'resend') as ok",
          [notice.id],
        )
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await db.query(
          "select finish_account_email($1,$2,false,'resend') as ok",
          [notice.id, notice.claim_token],
        )
      ).rows[0].ok,
    ).toBe(true);
    expect(
      (await db.query("select * from claim_account_emails()")).rows,
    ).toHaveLength(0);
  } finally {
    await db.exec("reset role");
  }
  await db.query(
    "update private.account_email_notifications set claimed_at=now()-interval '6 minutes' where id=$1",
    [notice.id],
  );
  const reclaimed = (await db.query("select * from claim_account_emails()"))
    .rows[0];
  expect(reclaimed.claim_token).not.toBe(notice.claim_token);
  expect(
    (
      await db.query("select finish_account_email($1,$2,true,'resend') as ok", [
        notice.id,
        notice.claim_token,
      ])
    ).rows[0].ok,
  ).toBe(false);
  await db.query(
    "update private.account_email_notifications set status='failed',attempts=5,claimed_at=now()-interval '6 minutes' where id=$1",
    [notice.id],
  );
  expect(
    (await db.query("select * from claim_account_emails()")).rows,
  ).toHaveLength(0);
});
test("obsolete approvals are superseded, unverified recipients are excluded and reminder opt-outs do not suppress account security", async () => {
  await db.query("update profiles set status='pending_approval' where id=$1", [
    ids.pending,
  ]);
  await db.exec("delete from private.account_email_notifications");
  await db.query("update profiles set status='active' where id=$1", [
    ids.pending,
  ]);
  await db.query("update profiles set status='suspended' where id=$1", [
    ids.pending,
  ]);
  const claimed = (await db.query("select * from claim_account_emails()")).rows;
  expect(claimed).toHaveLength(1);
  expect(claimed[0].kind).toBe("access_changed");
  expect(
    (
      await db.query(
        "select status from private.account_email_notifications where kind='approval'",
      )
    ).rows[0].status,
  ).toBe("superseded");
  await activeStatus();
  await asUser(db, ids.staff, () =>
    db.query(
      "insert into billing_reminder_preferences(profile_id,enabled) values($1,false) on conflict(profile_id) do update set enabled=false",
      [ids.staff],
    ),
  );
  await db.query("update profiles set role='finance' where id=$1", [ids.staff]);
  const event = (await db.query("select * from claim_account_emails()"))
    .rows[0];
  expect(event.email).toBe("staff@caedm.ca");
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    ids.staff,
  ]);
  await db.query(
    "update private.account_email_notifications set status='pending',claimed_at=null where id=$1",
    [event.id],
  );
  expect(
    (await db.query("select * from claim_account_emails()")).rows,
  ).toHaveLength(0);
});

test("invitation setup suppresses only its duplicate approval, preserving later security notices", async () => {
  const employee = "90000000-0000-4000-8000-000000000007";
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,'invited-notice@caedm.ca',now(),'fixture-password-hash')",
    [employee],
  );
  await db.query(
    "insert into employee_invitations(email,full_name,team_id,invited_by,onboarding_user_id,token_hash,status,accepted_user_id) values('invited-notice@caedm.ca','Invited Notice','10000000-0000-4000-8000-000000000001',$1,$2,$3,'accepted',$2)",
    [ids.admin, employee, "c".repeat(64)],
  );
  await db.query("update profiles set status='active' where id=$1", [employee]);
  expect(
    (
      await db.query(
        "select id from private.account_email_notifications where recipient_id=$1",
        [employee],
      )
    ).rows,
  ).toHaveLength(0);
  await db.query("update profiles set status='suspended' where id=$1", [
    employee,
  ]);
  const notices = (
    await db.query(
      "select kind,after_status from private.account_email_notifications where recipient_id=$1",
      [employee],
    )
  ).rows;
  expect(notices).toEqual([
    { kind: "access_changed", after_status: "suspended" },
  ]);
});

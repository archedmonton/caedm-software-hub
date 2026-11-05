import { beforeAll, beforeEach, afterAll, test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";

let db;
const team = "10000000-0000-4000-8000-000000000001";
const otherTeam = "10000000-0000-4000-8000-000000000002";
const today = "(now() at time zone 'America/Edmonton')::date";
beforeAll(async () => {
  db = await database();
  await fixtures(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    "update software_subscriptions set billing_paused=true; update billing_notifications set status='sent'; update notification_logs set status='sent'; delete from billing_reminder_preferences; delete from private.rate_limits",
  );
});
async function software(department = team, owner = ids.staff) {
  return (
    await db.query(
      `insert into software_subscriptions(name,vendor_id,team_id,owner_id,category,purchase_date,purchase_type,amount,currency,billing_cycle,billing_start_date,next_billing_date,last_reviewed_at) values('Scope fixture','20000000-0000-4000-8000-000000000001',$1,$2,'Test',${today},'subscription',12.34,'CAD','monthly',${today},${today}+14,${today}) returning id`,
      [department, owner],
    )
  ).rows[0].id;
}
async function preferences(actor, enabled = true, onlyOwned = false) {
  return asUser(db, actor, () =>
    db.query(
      "insert into billing_reminder_preferences(profile_id,enabled,only_owned) values($1,$2,$3) on conflict(profile_id) do update set enabled=excluded.enabled,only_owned=excluded.only_owned",
      [actor, enabled, onlyOwned],
    ),
  );
}
async function due(actor) {
  return (
    await db.query(
      `select subscription_id from private.due_billing_notices(${today}) where recipient_id=$1`,
      [actor],
    )
  ).rows
    .map((r) => r.subscription_id)
    .sort();
}
async function claimBilling() {
  return (await db.query("select * from claim_billing_notifications()")).rows;
}
async function claimReviews() {
  return (await db.query("select * from claim_notifications()")).rows;
}
async function reviewNotification(subscription, kind, recipient) {
  const review = (
    await db.query(
      `insert into usage_reviews(subscription_id,owner_id,renewal_date,deadline,response,responded_at) values($1,$2,${today}+14,${today}-1,$3,case when $3::text is null then null else now() end) returning id`,
      [subscription, ids.staff, kind === "response" ? "still_needed" : null],
    )
  ).rows[0].id;
  await db.query(
    "insert into notification_logs(review_id,recipient_id,kind) values($1,$2,$3)",
    [review, recipient, kind],
  );
  return review;
}

test("defaults stay owner-only while wider scope includes only records visible under recipient RLS", async () => {
  const owned = await software(),
    unassigned = await software(team, null),
    outside = await software(otherTeam, ids.other);
  expect(await due(ids.staff)).toEqual([owned]);
  await preferences(ids.staff);
  expect(await due(ids.staff)).toEqual([owned, unassigned].sort());
  await asUser(db, ids.staff, async () => {
    expect(
      (
        await db.query("select id from software_subscriptions where id=$1", [
          outside,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query("select private.software_notification_access($1,$2,false)", [
        outside,
        ids.staff,
      ]),
    ).rejects.toThrow();
  });
  for (const actor of [ids.finance, ids.admin]) {
    expect(await due(actor)).toEqual([]);
    await preferences(actor);
    expect(await due(actor)).toEqual([owned, unassigned, outside].sort());
  }
});

test("wider recipients use their own timing and only receive software emails when enabled", async () => {
  const subscription = await software();
  await preferences(ids.finance);
  await asUser(db, ids.finance, () =>
    db.exec(
      "update billing_reminder_preferences set first_notice_days=10,second_notice_days=3",
    ),
  );
  expect(await due(ids.finance)).toEqual([]);
  await db.query(
    `update software_subscriptions set next_billing_date=${today}+10 where id=$1`,
    [subscription],
  );
  expect(await due(ids.finance)).toEqual([subscription]);
  await preferences(ids.finance, false);
  expect(await due(ids.finance)).toEqual([]);
  expect(await due(ids.staff)).toEqual([subscription]);
});

test("billing claims recheck wider scope, role and department access after preparation", async () => {
  const subscription = await software(team, null);
  await preferences(ids.staff);
  await preferences(ids.finance);
  await db.exec("select prepare_billing_notifications()");
  await preferences(ids.staff, true, true);
  await db.query("update profiles set role='staff' where id=$1", [ids.finance]);
  try {
    expect(await claimBilling()).toHaveLength(0);
  } finally {
    await db.query("update profiles set role='finance' where id=$1", [
      ids.finance,
    ]);
  }
  await preferences(ids.finance, false);
  await preferences(ids.staff);
  await db.query(
    "delete from team_members where team_id=$1 and profile_id=$2",
    [team, ids.staff],
  );
  try {
    expect(await claimBilling()).toHaveLength(0);
  } finally {
    await db.query(
      "insert into team_members(team_id,profile_id,can_manage) values($1,$2,true)",
      [team, ids.staff],
    );
  }
  expect(
    (
      await db.query(
        "select id from billing_notifications where subscription_id=$1",
        [subscription],
      )
    ).rows,
  ).toHaveLength(2);
});

test("the master switch suppresses every software email kind without deleting review work", async () => {
  const reviewIds = [];
  for (const kind of ["initial", "follow_up", "escalation", "response"]) {
    const recipient = ["escalation", "response"].includes(kind)
      ? ids.finance
      : ids.staff;
    reviewIds.push(await reviewNotification(await software(), kind, recipient));
  }
  await preferences(ids.staff, false);
  await preferences(ids.finance, false);
  await db.exec("select prepare_billing_notifications()");
  expect(await claimBilling()).toHaveLength(0);
  expect(await claimReviews()).toHaveLength(0);
  expect(
    (
      await db.query("select id from usage_reviews where id=any($1::uuid[])", [
        reviewIds,
      ])
    ).rows,
  ).toHaveLength(4);
  await preferences(ids.staff);
  await preferences(ids.finance);
  expect((await claimReviews()).map((r) => r.kind).sort()).toEqual([
    "escalation",
    "follow_up",
    "initial",
    "response",
  ]);
});

test("owner-only filters Finance updates but wider scope does not broadcast or grant review response rights", async () => {
  const response = await reviewNotification(
    await software(),
    "response",
    ids.finance,
  );
  const escalation = await reviewNotification(
    await software(),
    "escalation",
    ids.finance,
  );
  expect(await claimReviews()).toHaveLength(0);
  await preferences(ids.finance);
  expect((await claimReviews()).map((r) => r.review_id).sort()).toEqual(
    [response, escalation].sort(),
  );
  const assigned = await reviewNotification(
    await software(),
    "initial",
    ids.staff,
  );
  // An incorrectly addressed queue row still cannot bypass assigned-reviewer routing.
  await db.query(
    "insert into notification_logs(review_id,recipient_id,kind) values($1,$2,'initial')",
    [assigned, ids.finance],
  );
  await asUser(db, ids.finance, () =>
    expect(
      db.query("select respond_to_review($1,'still_needed','')", [assigned]),
    ).rejects.toThrow("Access denied"),
  );
  expect((await claimReviews()).map((r) => r.email)).toEqual([
    "staff@caedm.ca",
  ]);
});

test("disabled recipients still have review assignments and can submit an in-app response", async () => {
  const subscription = await software();
  await preferences(ids.staff, false);
  await preferences(ids.finance, false);
  const review = (
    await asUser(db, ids.admin, () =>
      db.query("select request_usage_review($1) as id", [subscription]),
    )
  ).rows[0].id;
  expect(await claimReviews()).toHaveLength(0);
  await asUser(db, ids.staff, () =>
    db.query(
      "select respond_to_review($1,'still_needed','Reviewed in the Hub')",
      [review],
    ),
  );
  expect(
    (await db.query("select response from usage_reviews where id=$1", [review]))
      .rows[0].response,
  ).toBe("still_needed");
  expect(await claimReviews()).toHaveLength(0);
});

test("queued review emails recheck ownership and verified active identity", async () => {
  const subscription = await software();
  await reviewNotification(subscription, "initial", ids.staff);
  await db.query(
    "update software_subscriptions set owner_id=null where id=$1",
    [subscription],
  );
  expect(await claimReviews()).toHaveLength(0);
  await preferences(ids.staff);
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    ids.staff,
  ]);
  try {
    expect(await claimReviews()).toHaveLength(0);
    expect(await due(ids.staff)).toEqual([]);
  } finally {
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [ids.staff],
    );
  }
  await db.query("update profiles set status='suspended' where id=$1", [
    ids.staff,
  ]);
  try {
    expect(await claimReviews()).toHaveLength(0);
    expect(await due(ids.staff)).toEqual([]);
  } finally {
    await db.query("update profiles set status='active' where id=$1", [
      ids.staff,
    ]);
  }
});

test("scope is personal under RLS and cannot be changed for another recipient", async () => {
  await preferences(ids.staff);
  await asUser(db, ids.admin, async () => {
    expect(
      (
        await db.query(
          "update billing_reminder_preferences set only_owned=true where profile_id=$1 returning profile_id",
          [ids.staff],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        "insert into billing_reminder_preferences(profile_id,only_owned) values($1,false)",
        [ids.staff],
      ),
    ).rejects.toThrow();
  });
  for (const actor of [ids.pending, ids.unverified])
    await expect(preferences(actor)).rejects.toThrow();
  expect(await due(ids.pending)).toEqual([]);
  expect(await due(ids.unverified)).toEqual([]);
});

test("unfinished invitations block queued software email even when stale preferences and an active profile exist", async () => {
  const subscription = await software();
  await preferences(ids.staff);
  await reviewNotification(subscription, "initial", ids.staff);
  await db.exec("select prepare_billing_notifications()");
  const invitation = (
    await db.query(
      "insert into employee_invitations(email,full_name,team_id,invited_by,token_hash) values('staff@caedm.ca','Incomplete setup',$1,$2,repeat('a',64)) returning id",
      [team, ids.admin],
    )
  ).rows[0].id;
  try {
    expect(await due(ids.staff)).toEqual([]);
    expect(await claimBilling()).toHaveLength(0);
    expect(await claimReviews()).toHaveLength(0);
  } finally {
    await db.query("delete from employee_invitations where id=$1", [
      invitation,
    ]);
  }
});

test("upgrade preserves opt-outs, custom timing, queues and financial history", async () => {
  const upgrade = await database({ beforeVersion: "202611040003" });
  try {
    await fixtures(upgrade);
    await asUser(upgrade, ids.staff, () =>
      upgrade.query(
        "insert into billing_reminder_preferences(profile_id,enabled,first_notice_days,second_notice_days) values($1,false,21,3)",
        [ids.staff],
      ),
    );
    await asUser(upgrade, ids.finance, () =>
      upgrade.exec(
        "insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference) select id,current_date,19.95,1,'CAD','SCOPE-UPGRADE' from software_subscriptions order by id limit 1",
      ),
    );
    const snapshot = async () => ({
      expenses: (
        await upgrade.query("select * from expense_records order by id")
      ).rows,
      software: (
        await upgrade.query("select * from software_subscriptions order by id")
      ).rows,
      settings: (await upgrade.query("select * from application_settings"))
        .rows,
      queue: (
        await upgrade.query("select * from notification_logs order by id")
      ).rows,
      billing: (
        await upgrade.query("select * from billing_notifications order by id")
      ).rows,
    });
    await upgrade.exec(
      "select prepare_reminders(); select prepare_billing_notifications()",
    );
    const before = await snapshot();
    await upgrade.exec(
      await readFile(
        "supabase/migrations/202611040003_notification_scope.sql",
        "utf8",
      ),
    );
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await upgrade.query(
          "select enabled,only_owned,first_notice_days,second_notice_days from billing_reminder_preferences",
        )
      ).rows,
    ).toEqual([
      {
        enabled: false,
        only_owned: true,
        first_notice_days: 21,
        second_notice_days: 3,
      },
    ]);
  } finally {
    await upgrade.close();
  }
}, 30000);

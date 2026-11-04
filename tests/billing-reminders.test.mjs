import { beforeAll, beforeEach, afterAll, test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
let db;
const team = "10000000-0000-4000-8000-000000000001";
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
    "update software_subscriptions set billing_paused=true;update billing_notifications set status='sent';delete from billing_reminder_preferences;delete from private.rate_limits",
  );
});
async function tool(days = 14) {
  return (
    await db.query(
      `insert into software_subscriptions(name,vendor_id,team_id,owner_id,category,purchase_date,purchase_type,amount,currency,billing_cycle,billing_start_date,next_billing_date,cancellation_notice_days,last_reviewed_at) values('Billing fixture','20000000-0000-4000-8000-000000000001',$1,$2,'Test',${today},'subscription',12.34,'CAD','monthly',${today},${today}+$3::integer,30,${today}) returning id`,
      [team, ids.staff, days],
    )
  ).rows[0].id;
}
async function prepare() {
  await db.exec("select prepare_billing_notifications()");
}
async function claim() {
  return (await db.query("select * from claim_billing_notifications()")).rows;
}
async function service(fn) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function preference(values = {}) {
  const p = { enabled: true, first: 14, second: 7, ...values };
  await asUser(db, ids.staff, () =>
    db.query(
      "insert into billing_reminder_preferences(profile_id,enabled,first_notice_days,second_notice_days) values($1,$2,$3,$4) on conflict(profile_id) do update set enabled=excluded.enabled,first_notice_days=excluded.first_notice_days,second_notice_days=excluded.second_notice_days",
      [ids.staff, p.enabled, p.first, p.second],
    ),
  );
}
test("personal preferences are isolated by RLS and require active verified access", async () => {
  await preference({ first: 21, second: 3 });
  for (const actor of [ids.finance, ids.admin, ids.pending, ids.unverified])
    await asUser(db, actor, async () => {
      expect(
        (await db.query("select * from billing_reminder_preferences")).rows,
      ).toHaveLength(0);
      await expect(
        db.query(
          "insert into billing_reminder_preferences(profile_id) values($1)",
          [ids.staff],
        ),
      ).rejects.toThrow();
      expect(
        (
          await db.query(
            "update billing_reminder_preferences set enabled=false where profile_id=$1 returning profile_id",
            [ids.staff],
          )
        ).rows,
      ).toHaveLength(0);
    });
  for (const actor of [ids.pending, ids.unverified])
    await asUser(db, actor, () =>
      expect(
        db.query(
          "insert into billing_reminder_preferences(profile_id) values($1)",
          [actor],
        ),
      ).rejects.toThrow(),
    );
  await asUser(db, ids.staff, () =>
    expect(
      db.query("update billing_reminder_preferences set profile_id=$1", [
        ids.finance,
      ]),
    ).rejects.toThrow(),
  );
  expect(
    (
      await db.query(
        "select first_notice_days,second_notice_days from billing_reminder_preferences",
      )
    ).rows[0],
  ).toEqual({ first_notice_days: 21, second_notice_days: 3 });
});
test("defaults queue notices 14 and 7 days before billing independently of cancellation deadline and recent reviews", async () => {
  const initial = await tool(14),
    final = await tool(7),
    future = await tool(15);
  await prepare();
  await prepare();
  const rows = (
    await db.query(
      "select subscription_id,stage,notice_days from billing_notifications where status='pending'",
    )
  ).rows;
  expect(rows).toContainEqual({
    subscription_id: initial,
    stage: "initial",
    notice_days: 14,
  });
  expect(rows).toContainEqual({
    subscription_id: final,
    stage: "follow_up",
    notice_days: 7,
  });
  expect(rows.some((r) => r.subscription_id === future)).toBe(false);
  expect(rows).toHaveLength(2);
  expect(await claim()).toHaveLength(2);
});
test("custom offsets apply and missed runs send only the most recent due notice", async () => {
  await preference({ first: 21, second: 3 });
  const early = await tool(21),
    late = await tool(2);
  await prepare();
  const rows = await claim();
  expect(rows.find((r) => r.subscription_id === early)).toMatchObject({
    notice_days: 21,
    days_until_billing: 21,
  });
  expect(rows.find((r) => r.subscription_id === late)).toMatchObject({
    notice_days: 3,
    days_until_billing: 2,
  });
  expect(
    (
      await db.query(
        "select * from billing_notifications where subscription_id=$1",
        [late],
      )
    ).rows,
  ).toHaveLength(1);
});
test("the same cycle can send both stages once and preference edits do not resend a delivered stage", async () => {
  const id = await tool();
  await prepare();
  const n = (await claim())[0];
  expect(
    (
      await db.query(
        "select finish_billing_notification($1,$2,true,'local','subject','body') as ok",
        [n.id, n.claim_token],
      )
    ).rows[0].ok,
  ).toBe(true);
  await preference({ first: 30, second: 7 });
  await prepare();
  expect(await claim()).toHaveLength(0);
  await db.query(`select prepare_billing_notifications(${today}+7)`);
  expect(
    (
      await db.query(
        "select stage from billing_notifications where subscription_id=$1 order by stage",
        [id],
      )
    ).rows.map((r) => r.stage),
  ).toEqual(["follow_up", "initial"]);
  // Future-prepared rows cannot be claimed before their actual Edmonton due date.
  expect(await claim()).toHaveLength(0);
});
test("claiming rechecks opt-out, paused billing, cancelled software, date and owner changes", async () => {
  for (const change of ["opt-out", "pause", "cancel", "date", "owner"]) {
    const id = await tool();
    await prepare();
    if (change === "opt-out") await preference({ enabled: false });
    if (change === "pause")
      await db.query(
        "update software_subscriptions set billing_paused=true where id=$1",
        [id],
      );
    if (change === "cancel")
      await db.query(
        "update software_subscriptions set status='cancelled' where id=$1",
        [id],
      );
    if (change === "date")
      await db.query(
        `update software_subscriptions set next_billing_date=${today}+20 where id=$1`,
        [id],
      );
    if (change === "owner")
      await db.query(
        "update software_subscriptions set owner_id=null where id=$1",
        [id],
      );
    expect(await claim()).toHaveLength(0);
    await db.query(
      "update billing_notifications set status='sent' where subscription_id=$1",
      [id],
    );
    await db.exec("delete from billing_reminder_preferences");
    await db.query(
      "update software_subscriptions set billing_paused=true where id=$1",
      [id],
    );
  }
});
test("billing-day, overdue non-renewing, one-time, unverified and unfinished invitation owners are excluded", async () => {
  const day = await tool(0),
    past = await tool(1),
    oneTime = await tool(),
    unverified = await tool();
  await db.query(
    `update software_subscriptions set next_billing_date=${today}-1,billing_start_date=${today}-30,auto_renew=false where id=$1`,
    [past],
  );
  await db.query(
    "update software_subscriptions set purchase_type='one_time',billing_cycle='one_time' where id=$1",
    [oneTime],
  );
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    ids.staff,
  ]);
  try {
    await prepare();
    expect(await claim()).toHaveLength(0);
  } finally {
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [ids.staff],
    );
  }
  await db.query(
    "update software_subscriptions set billing_paused=true where id=$1",
    [unverified],
  );
  await prepare();
  expect(await claim()).toHaveLength(0);
  expect([day, past, oneTime]).toHaveLength(3);
});
test("exclusive leases, token validation, retry limits and stable message identity prevent ordinary duplicate sends", async () => {
  await tool();
  await prepare();
  const first = (await claim())[0];
  expect(await claim()).toHaveLength(0);
  expect(
    (
      await db.query(
        "select finish_billing_notification($1,$2,true,'local','x','x') as ok",
        [first.id, randomUUID()],
      )
    ).rows[0].ok,
  ).toBe(false);
  await db.query(
    "select finish_billing_notification($1,$2,false,'local','x','x')",
    [first.id, first.claim_token],
  );
  expect(await claim()).toHaveLength(0);
  await db.query(
    "update billing_notifications set claimed_at=now()-interval '6 minutes' where id=$1",
    [first.id],
  );
  const retry = (await claim())[0];
  expect(retry.id).toBe(first.id);
  expect(retry.claim_token).not.toBe(first.claim_token);
  await db.query(
    "update billing_notifications set claimed_at=now()-interval '31 minutes' where id=$1",
    [first.id],
  );
  const reclaimed = (await claim())[0];
  expect(reclaimed.id).toBe(first.id);
  await db.query(
    "update billing_notifications set status='failed',attempts=5 where id=$1",
    [first.id],
  );
  expect(await claim()).toHaveLength(0);
  expect(
    (
      await db.query(
        "select * from private.billing_notification_attempts where notification_id=$1",
        [first.id],
      )
    ).rows,
  ).toHaveLength(3);
});
test("ordinary clients cannot enqueue, claim, finish or alter billing delivery state", async () => {
  await tool();
  await prepare();
  const notification = (
    await db.query(
      "select id from billing_notifications where status='pending'",
    )
  ).rows[0].id;
  for (const actor of [
    ids.admin,
    ids.finance,
    ids.staff,
    ids.pending,
    ids.unverified,
  ])
    await asUser(db, actor, async () => {
      await expect(
        db.query("select prepare_billing_notifications()"),
      ).rejects.toThrow();
      await expect(
        db.query("select * from claim_billing_notifications()"),
      ).rejects.toThrow();
      await expect(
        db.query("select finish_billing_notification($1,$2,true,'x','x','x')", [
          notification,
          randomUUID(),
        ]),
      ).rejects.toThrow();
      await expect(
        db.query("update billing_notifications set status='sent' where id=$1", [
          notification,
        ]),
      ).rejects.toThrow();
    });
  expect(
    await service(() =>
      db.query("select * from claim_billing_notifications()"),
    ),
  ).toHaveProperty("rows");
});
test("delivery log visibility follows recipient access and Finance authority", async () => {
  await tool();
  await prepare();
  for (const actor of [ids.staff, ids.finance, ids.admin])
    await asUser(db, actor, async () =>
      expect(
        (await db.query("select * from billing_notifications")).rows.length,
      ).toBeGreaterThan(0),
    );
  for (const actor of [ids.other, ids.pending, ids.unverified])
    await asUser(db, actor, async () =>
      expect(
        (await db.query("select * from billing_notifications")).rows,
      ).toHaveLength(0),
    );
});
test("upgrade leaves historical financial records and organization review rules unchanged", async () => {
  const upgrade = await database({ beforeVersion: "202611040002" });
  try {
    await fixtures(upgrade);
    await asUser(upgrade, ids.finance, () =>
      upgrade.exec(
        "insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference) select id,current_date,19.95,1,'CAD','BILLING-UPGRADE' from software_subscriptions order by id limit 1",
      ),
    );
    const snapshot = async () => ({
      settings: (await upgrade.query("select * from application_settings"))
        .rows,
      software: (
        await upgrade.query("select * from software_subscriptions order by id")
      ).rows,
      expenses: (
        await upgrade.query("select * from expense_records order by id")
      ).rows,
    });
    const before = await snapshot();
    await upgrade.exec(
      await readFile(
        "supabase/migrations/202611040002_billing_reminders.sql",
        "utf8",
      ),
    );
    expect(await snapshot()).toEqual(before);
  } finally {
    await upgrade.close();
  }
}, 30000);

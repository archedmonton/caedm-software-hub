import { beforeAll, afterAll, test, expect } from "vitest";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
let db;
beforeAll(async () => {
  db = await database();
  await fixtures(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});
async function tool(name, changes = "") {
  const { rows } = await db.query(
    `insert into software_subscriptions(name,vendor_id,team_id,owner_id,category,purchase_date,purchase_type,amount,currency,billing_cycle,billing_start_date,next_billing_date,cancellation_notice_days)values($1,'20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','${ids.staff}','Test',current_date,'subscription',10,'CAD','monthly',current_date,current_date+10,3) returning id`,
    [name],
  );
  const id = rows[0].id;
  if (changes)
    await db.exec(
      `update software_subscriptions set ${changes} where id='${id}'`,
    );
  return id;
}
test("review frequency suppresses new requests independently of monthly billing", async () => {
  const id = await tool(
    "Frequency test",
    `last_reviewed_at=current_date-30,review_frequency_months=12`,
  );
  await db.exec("select prepare_reminders(current_date)");
  expect(
    (
      await db.query("select * from usage_reviews where subscription_id=$1", [
        id,
      ])
    ).rows,
  ).toHaveLength(0);
  await db.exec(
    `update software_subscriptions set last_reviewed_at=current_date-400 where id='${id}';select prepare_reminders(current_date);select prepare_reminders(current_date+35);`,
  );
  expect(
    (
      await db.query("select * from usage_reviews where subscription_id=$1", [
        id,
      ])
    ).rows,
  ).toHaveLength(1);
});
test("paused subscriptions produce no review requests or recurring deliveries", async () => {
  const id = await tool("Paused test", "billing_paused=true");
  await db.exec("select prepare_reminders(current_date)");
  expect(
    (
      await db.query("select * from usage_reviews where subscription_id=$1", [
        id,
      ])
    ).rows,
  ).toHaveLength(0);
});
test("follow-up waits until after initial delivery; overdue review escalates once", async () => {
  const id = await tool("Follow-up test");
  const review = (
    await asUser(db, ids.admin, () =>
      db.query("select request_usage_review($1) as id", [id]),
    )
  ).rows[0].id;
  await db.exec(`select prepare_reminders(current_date);`);
  expect(
    (
      await db.query(
        `select * from notification_logs where review_id=$1 and kind='follow_up'`,
        [review],
      )
    ).rows,
  ).toHaveLength(0);
  await db.exec(
    `update notification_logs set status='sent',delivered_at=now()-interval '1 day' where review_id='${review}' and kind='initial';select prepare_reminders(current_date);`,
  );
  expect(
    (
      await db.query(
        `select * from notification_logs where review_id=$1 and kind='follow_up'`,
        [review],
      )
    ).rows,
  ).toHaveLength(1);
  await db.exec(
    `select prepare_reminders(current_date+8);select prepare_reminders(current_date+9);`,
  );
  expect(
    (
      await db.query(
        `select * from notification_logs where review_id=$1 and kind='escalation'`,
        [review],
      )
    ).rows,
  ).toHaveLength(2);
});
test("failed deliveries retry with distinct attempts and stale completion tokens are ignored", async () => {
  const id = await tool("Retry test");
  await asUser(db, ids.admin, () =>
    db.exec(`select request_usage_review('${id}')`),
  );
  const first = (await db.query("select * from claim_notifications()")).rows;
  const n = first.find((row) => row.software_name === "Retry test");
  expect(n).toBeTruthy();
  await db.query(
    `select finish_notification($1,$2,false,'local','Retry test','Body')`,
    [n.id, n.claim_token],
  );
  const retried = (
    await db.query("select * from claim_notifications()")
  ).rows.find((row) => row.id === n.id);
  expect(retried.claim_token).not.toBe(n.claim_token);
  await db.query(
    `select finish_notification($1,$2,true,'local','Stale','Body')`,
    [n.id, n.claim_token],
  );
  expect(
    (await db.query("select status from notification_logs where id=$1", [n.id]))
      .rows[0].status,
  ).toBe("sending");
  await db.query(
    `select finish_notification($1,$2,true,'local','Current','Body')`,
    [n.id, retried.claim_token],
  );
  expect(
    (
      await db.query(
        "select status from notification_attempts where notification_id=$1 order by attempt",
        [n.id],
      )
    ).rows.map((row) => row.status),
  ).toEqual(["failed", "sent"]);
});
test("team access removal requires transferring active ownership first", async () => {
  await asUser(db, ids.admin, async () => {
    await expect(
      db.exec(
        `select remove_membership('10000000-0000-4000-8000-000000000001','${ids.staff}')`,
      ),
    ).rejects.toThrow("Transfer");
  });
});
test("clients cannot forge completed review timestamps or recorded expense snapshots", async () => {
  await asUser(db, ids.staff, async () => {
    await expect(
      db.exec(
        `update software_subscriptions set last_reviewed_at=current_date+100 where team_id='10000000-0000-4000-8000-000000000001'`,
      ),
    ).rejects.toThrow("permission denied");
  });
  await asUser(db, ids.finance, async () => {
    await expect(
      db.exec(`update expense_records set vendor_name='Forged'`),
    ).rejects.toThrow("permission denied");
  });
});
test("all sensitive public tables have RLS and anonymous users have no data grants", async () => {
  const { rows } = await db.query(
    `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
  );
  expect(rows).toEqual([]);
  await db.exec("set role anon");
  try {
    await expect(
      db.exec("select * from software_subscriptions"),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.exec("reset role");
  }
});

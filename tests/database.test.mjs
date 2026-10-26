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
test("signup hook and trigger reject external and lookalike domains", async () => {
  for (const email of [
    "person@gmail.com",
    "person@caedm.ca.evil.test",
    "person@sub.caedm.ca",
    "person@@caedm.ca",
  ]) {
    const { rows } = await db.query(
      `select public.before_user_created($1::jsonb) as result`,
      [JSON.stringify({ user: { email } })],
    );
    expect(rows[0].result.error.http_code).toBe(403);
    await expect(
      db.query(`insert into auth.users(id,email)values(gen_random_uuid(),$1)`, [
        email,
      ]),
    ).rejects.toThrow();
  }
});
test("signup metadata cannot self-assign elevated roles or approval", async () => {
  const { rows } = await db.query(
    "select role,status from profiles where id=$1",
    [ids.pending],
  );
  expect(rows[0]).toEqual({ role: "staff", status: "pending_approval" });
});
test("pending and unverified accounts cannot read business data", async () => {
  for (const id of [ids.pending, ids.unverified])
    await asUser(db, id, async () => {
      for (const table of [
        "software_subscriptions",
        "expense_records",
        "vendors",
        "teams",
        "application_settings",
        "audit_logs",
      ])
        expect(
          (await db.query(`select * from public.${table}`)).rows,
        ).toHaveLength(0);
    });
  await expect(
    db.exec(`update profiles set status='active' where id='${ids.unverified}'`),
  ).rejects.toThrow("verified");
});
test("team isolation and direct API role escalation protection", async () => {
  await asUser(db, ids.staff, async () => {
    expect(
      (await db.query("select distinct team_id from software_subscriptions"))
        .rows,
    ).toEqual([{ team_id: "10000000-0000-4000-8000-000000000001" }]);
    expect(
      (
        await db.query(
          `update profiles set role='admin' where id='${ids.staff}' returning id`,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.exec(
        `update profiles set email='intruder@caedm.ca' where id='${ids.staff}'`,
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          `update software_subscriptions set name='Unauthorized' where team_id='10000000-0000-4000-8000-000000000002' returning id`,
        )
      ).rows,
    ).toHaveLength(0);
    expect((await db.query("select * from expense_records")).rows).toHaveLength(
      0,
    );
  });
});
test("software can be created/edited by an authorized team member", async () => {
  await asUser(db, ids.staff, async () => {
    const { rows } = await db.query(
      `insert into software_subscriptions(name,vendor_id,team_id,owner_id,category,purchase_date,purchase_type,amount,currency,billing_cycle,billing_start_date,next_billing_date)values('Team Tool','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','${ids.staff}','Productivity',current_date,'subscription',12.34,'CAD','monthly',current_date,current_date+10) returning id`,
    );
    expect(
      (
        await db.query(
          `update software_subscriptions set amount=15.25 where id=$1 returning amount`,
          [rows[0].id],
        )
      ).rows[0].amount,
    ).toBe("15.25");
    await expect(
      db.exec(
        `update software_subscriptions set owner_id='${ids.other}' where id='${rows[0].id}'`,
      ),
    ).rejects.toThrow("Owner");
  });
});
test("finance records confirmed expenses with historical reference snapshots", async () => {
  await asUser(db, ids.finance, async () => {
    await db.exec(
      `insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference)values('40000000-0000-4000-8000-000000000001',current_date,100,5,'CAD','TEST-INVOICE')`,
    );
    expect(
      (await db.query("select * from expense_records")).rows[0],
    ).toMatchObject({
      vendor_name: "Microsoft (Demo)",
      team_name: "IT Services (Demo)",
      amount: "100.00",
      tax: "5.00",
    });
  });
  await asUser(db, ids.staff, async () => {
    await expect(
      db.exec(
        `insert into expense_records(subscription_id,transaction_date,amount,currency)values('40000000-0000-4000-8000-000000000001',current_date,10,'CAD')`,
      ),
    ).rejects.toThrow();
  });
});
test("review response requires exact assigned owner and cannot be overwritten", async () => {
  const { rows } = await asUser(db, ids.admin, () =>
    db.query(
      `select request_usage_review('40000000-0000-4000-8000-000000000005') as id`,
    ),
  );
  const id = rows[0].id;
  await asUser(db, ids.other, async () => {
    await expect(
      db.exec(`select respond_to_review('${id}','still_needed','')`),
    ).rejects.toThrow("Access denied");
  });
  await asUser(db, ids.staff, async () => {
    await db.exec(
      `select respond_to_review('${id}','not_needed','No longer used')`,
    );
    await expect(
      db.exec(`select respond_to_review('${id}','still_needed','')`),
    ).rejects.toThrow("completed");
  });
  expect(
    (await db.query("select response from usage_reviews where id=$1", [id]))
      .rows[0].response,
  ).toBe("not_needed");
});
test("unassigned review cannot be answered through direct RPC", async () => {
  const { rows } = await db.query(
    `insert into usage_reviews(subscription_id,renewal_date,deadline) values('40000000-0000-4000-8000-000000000008',current_date+10,current_date) returning id`,
  );
  await asUser(db, ids.staff, async () => {
    await expect(
      db.exec(`select respond_to_review('${rows[0].id}','still_needed','')`),
    ).rejects.toThrow("Access denied");
  });
});
test("reminder generation is idempotent and queue claims are exclusive", async () => {
  await db.exec(
    `select prepare_reminders(current_date);select prepare_reminders(current_date);`,
  );
  const counts = await db.query(
    `select review_id,recipient_id,kind,count(*) as count from notification_logs group by 1,2,3 having count(*)>1`,
  );
  expect(counts.rows).toHaveLength(0);
  const first = (await db.query("select * from claim_notifications()")).rows;
  const second = (await db.query("select * from claim_notifications()")).rows;
  expect(first.length).toBeGreaterThan(0);
  expect(second).toHaveLength(0);
  for (const n of first)
    await db.query(
      `select finish_notification($1,$2,true,'local','Test','Preview')`,
      [n.id, n.claim_token],
    );
  expect(
    (await db.query(`select * from notification_attempts where status='sent'`))
      .rows.length,
  ).toBe(first.length);
});
test("privileged jobs cannot be invoked by ordinary users", async () => {
  await asUser(db, ids.staff, async () => {
    for (const sql of [
      "select prepare_reminders()",
      "select * from claim_notifications()",
      `select consume_auth_limit(repeat('a',64))`,
    ])
      await expect(db.exec(sql)).rejects.toThrow("permission denied");
  });
});
test("cancelled and archived records remain queryable and cannot be deleted", async () => {
  await asUser(db, ids.finance, async () => {
    await db.exec(
      `update software_subscriptions set status='archived',auto_renew=false where id='40000000-0000-4000-8000-000000000001'`,
    );
    expect(
      (
        await db.query(
          `select status from software_subscriptions where id='40000000-0000-4000-8000-000000000001'`,
        )
      ).rows[0].status,
    ).toBe("archived");
    expect((await db.query("select * from expense_records")).rows).toHaveLength(
      1,
    );
    await expect(
      db.exec(
        `delete from software_subscriptions where id='40000000-0000-4000-8000-000000000001'`,
      ),
    ).rejects.toThrow();
  });
});
test("suspension immediately revokes access with the same authenticated user", async () => {
  await db.exec(
    `update profiles set status='suspended' where id='${ids.other}'`,
  );
  await asUser(db, ids.other, async () => {
    expect(
      (await db.query("select * from software_subscriptions")).rows,
    ).toHaveLength(0);
  });
});
test("last active administrator cannot be removed", async () => {
  await expect(
    db.exec(`update profiles set status='deactivated' where id='${ids.admin}'`),
  ).rejects.toThrow("administrator");
});

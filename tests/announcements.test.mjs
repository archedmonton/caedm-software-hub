import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  test,
  expect,
} from "vitest";
import { randomUUID } from "node:crypto";
import {
  database,
  fixtures,
  asUser,
  ids,
  recoverRejectedStatements,
} from "./db-helper.mjs";
let db;
async function actor(fn, id = ids.admin) {
  return asUser(db, id, fn);
}
async function worker(fn) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
async function draft(
  id = randomUUID(),
  body = "A useful Software Hub announcement.",
) {
  await actor(() =>
    db.query(
      "select save_developer_announcement($1,'blank','Test announcement','Test subject',$2,'everyone','{}')",
      [id, body],
    ),
  );
  return id;
}
async function preview(id) {
  return (
    await actor(() =>
      db.query("select preview_developer_announcement($1) as v", [id]),
    )
  ).rows[0].v;
}
async function acceptedTest(id) {
  await preview(id);
  const row = (
    await actor(() =>
      db.query("select queue_announcement_test($1) as id", [id]),
    )
  ).rows[0].id;
  const items = (
    await worker(() =>
      db.query("select claim_announcement_emails($1) as v", [row]),
    )
  ).rows[0].v;
  expect(items).toHaveLength(1);
  await finish(items[0], true);
  return items[0];
}
async function finish(item, accepted = true) {
  return worker(() =>
    db.query("select finish_announcement_email($1,$2,$3,'resend',$4) as v", [
      item.id,
      item.claim_token,
      accepted,
      `provider-${item.id}`,
    ]),
  );
}
async function queue(id) {
  const count = (await preview(id)).audience.count;
  return actor(() =>
    db.query("select queue_developer_announcement($1,$2,true) as n", [
      id,
      count,
    ]),
  );
}
beforeAll(async () => {
  db = await database();
  await fixtures(db);
  await db.query(
    "insert into private.developer_access(profile_id) values($1)",
    [ids.admin],
  );
  recoverRejectedStatements(db);
}, 60000);
beforeEach(async () => {
  await db.exec("begin;delete from private.rate_limits");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});
test("audience comes from actual accounts, excludes disabled and deduplicates invitations", async () => {
  await db.query(
    "insert into employee_invitations(email,full_name,team_id,role,invited_by,token_hash,status,expires_at) values('staff@caedm.ca','Staff duplicate','10000000-0000-4000-8000-000000000001','staff',$1,$2,'accepted',now()+interval '1 day'),('invited-only@caedm.ca','New employee','10000000-0000-4000-8000-000000000001','staff',$1,$3,'pending',now()+interval '1 day'),('revoked@caedm.ca','Revoked','10000000-0000-4000-8000-000000000001','staff',$1,$4,'revoked',now()+interval '1 day')",
    [ids.admin, "a".repeat(64), "b".repeat(64), "c".repeat(64)],
  );
  await db.query("update profiles set status='suspended' where id=$1", [
    ids.other,
  ]);
  const value = (
    await actor(() =>
      db.query("select developer_announcement_audience('everyone') as v"),
    )
  ).rows[0].v;
  expect(value.duplicates_removed).toBe(1);
  expect(value.excluded).toBeGreaterThanOrEqual(2);
  expect(value.people.map((p) => p.email)).toContain("invited-only@caedm.ca");
  expect(value.people.map((p) => p.email)).not.toContain("revoked@caedm.ca");
  expect(value.people.map((p) => p.email)).not.toContain("other@caedm.ca");
  const selected = (
    await actor(() =>
      db.query(
        "select developer_announcement_audience('selected',ARRAY[' STAFF@CAEDM.CA ','staff@caedm.ca']) as v",
      ),
    )
  ).rows[0].v;
  expect(selected.count).toBe(1);
});
test("preview, current accepted test, nonempty audience and explicit count confirmation are required", async () => {
  const id = await draft();
  await actor(async () => {
    await expect(
      db.query("select queue_announcement_test($1)", [id]),
    ).rejects.toThrow(/Preview/);
    await expect(
      db.query("select queue_developer_announcement($1,6,true)", [id]),
    ).rejects.toThrow(/Preview/);
  });
  await acceptedTest(id);
  await actor(async () => {
    await expect(
      db.query("select queue_developer_announcement($1,0,true)", [id]),
    ).rejects.toThrow(/Audience/);
    await expect(
      db.query("select queue_developer_announcement($1,6,false)", [id]),
    ).rejects.toThrow(/confirmation/);
  });
  expect((await queue(id)).rows[0].n).toBeGreaterThan(0);
});
test("changed content invalidates test proof; repeated queue calls do not duplicate recipients", async () => {
  const id = await draft();
  await acceptedTest(id);
  await draft(id, "A changed message needs another test.");
  await preview(id);
  await expect(queue(id)).rejects.toThrow(/test/);
  await acceptedTest(id);
  const first = await queue(id);
  const second = await queue(id);
  expect(first.rows[0].n).toBe(second.rows[0].n);
  expect(
    (
      await db.query(
        "select count(*)::int as n from private.announcement_recipients where announcement_id=$1 and not is_test",
        [id],
      )
    ).rows[0].n,
  ).toBe(first.rows[0].n);
});
test("claims are individual, bounded and not reclaimed concurrently; stale finish is rejected", async () => {
  const id = await draft();
  await acceptedTest(id);
  await queue(id);
  const claimed = (
    await worker(() => db.query("select claim_announcement_emails() as v"))
  ).rows[0].v;
  expect(claimed.length).toBeGreaterThan(0);
  expect(claimed.length).toBeLessThanOrEqual(10);
  expect(new Set(claimed.map((r) => r.email)).size).toBe(claimed.length);
  expect(
    (await worker(() => db.query("select claim_announcement_emails() as v")))
      .rows[0].v,
  ).toEqual([]);
  const item = claimed[0];
  expect(
    (
      await worker(() =>
        db.query(
          "select finish_announcement_email($1,$2,true,'resend',null) as v",
          [item.id, randomUUID()],
        ),
      )
    ).rows[0].v,
  ).toBe(false);
  await finish(item);
  expect(
    (
      await db.query(
        "select status from private.announcement_recipients where id=$1",
        [item.id],
      )
    ).rows[0].status,
  ).toBe("accepted");
});
test("revoked author and suppressed recipients are skipped before delivery", async () => {
  const id = await draft();
  await acceptedTest(id);
  await queue(id);
  await db.query(
    "insert into private.email_suppressions(email,reason) values('staff@caedm.ca','operator_blocked')",
  );
  const claimed = (
    await worker(() => db.query("select claim_announcement_emails() as v"))
  ).rows[0].v;
  expect(claimed.map((r) => r.email)).not.toContain("staff@caedm.ca");
  await db.query(
    "update private.developer_access set active=false where profile_id=$1",
    [ids.admin],
  );
  await db.exec(
    "update private.announcement_recipients set status='queued' where status='sending'",
  );
  expect(
    (await worker(() => db.query("select claim_announcement_emails() as v")))
      .rows[0].v,
  ).toEqual([]);
});
test("signed-receipt capability is recipient-bound, deduplicated, and never exposed in developer detail", async () => {
  const id = await draft();
  const item = await acceptedTest(id);
  async function receipt(capability, event, kind) {
    await db.exec("set role anon");
    try {
      return (
        await db.query(
          "select record_announcement_receipt($1,$2,$3,$4,now()) as v",
          [capability, event, kind, `provider-${item.id}`],
        )
      ).rows[0].v;
    } finally {
      await db.exec("reset role");
    }
  }
  expect(await receipt(randomUUID(), "fake", "delivered")).toBe(false);
  expect(await receipt(item.delivery_ref, "real-event", "delivered")).toBe(
    true,
  );
  expect(await receipt(item.delivery_ref, "real-event", "delivered")).toBe(
    true,
  );
  expect(
    (
      await db.query(
        "select count(*)::int as n from private.announcement_provider_events",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query(
        "select status from private.announcement_recipients where id=$1",
        [item.id],
      )
    ).rows[0].status,
  ).toBe("delivered");
  const detail = (
    await actor(() =>
      db.query("select developer_announcement_detail($1) as v", [id]),
    )
  ).rows[0].v;
  expect(JSON.stringify(detail)).not.toContain(item.delivery_ref);
  expect(JSON.stringify(detail)).not.toContain(item.claim_token);
  await receipt(item.delivery_ref, "bounced-event", "bounced");
  expect(
    (await db.query("select email from private.email_suppressions")).rows[0]
      .email,
  ).toBe(item.email);
});
test("outbox exposes no service capabilities and Staff Developer sees no other employees' financial activity", async () => {
  const review = (
    await db.query(
      "insert into usage_reviews(subscription_id,owner_id,renewal_date,deadline) select id,$1,current_date+14,current_date+7 from software_subscriptions where team_id='10000000-0000-4000-8000-000000000002' limit 1 returning id",
      [ids.other],
    )
  ).rows[0].id;
  await db.query(
    "insert into notification_logs(review_id,recipient_id,kind,subject) values($1,$2,'escalation','Restricted Finance escalation')",
    [review, ids.finance],
  );
  await db.query(
    "insert into billing_notifications(subscription_id,recipient_id,billing_date,stage,notice_days,subject) select id,$1,current_date+14,'initial',14,'Restricted billing notice' from software_subscriptions limit 1",
    [ids.finance],
  );
  await db.query(
    "insert into private.developer_access(profile_id) values($1)",
    [ids.staff],
  );
  const activity = (
    await actor(
      () => db.query("select developer_email_activity() as v"),
      ids.staff,
    )
  ).rows[0].v;
  expect(Array.isArray(activity.outbox)).toBe(true);
  expect(JSON.stringify(activity)).not.toContain("claim_token");
  expect(JSON.stringify(activity)).not.toContain("delivery_ref");
  expect(JSON.stringify(activity)).not.toContain(
    "Restricted Finance escalation",
  );
  expect(JSON.stringify(activity)).not.toContain("Restricted billing notice");
});
test("rendered payload snapshot remains immutable across retries", async () => {
  const id = await draft();
  await preview(id);
  const recipient = (
    await actor(() =>
      db.query("select queue_announcement_test($1) as id", [id]),
    )
  ).rows[0].id;
  const item = (
    await worker(() =>
      db.query("select claim_announcement_emails($1) as v", [recipient]),
    )
  ).rows[0].v[0];
  const payload = {
    id: `announcement-${item.id}`,
    to: item.email,
    purpose: "notifications",
    deliveryRef: item.delivery_ref,
    html: "<p>Frozen content</p>",
  };
  const first = (
    await worker(() =>
      db.query("select snapshot_announcement_message($1,$2,$3) as v", [
        item.id,
        item.claim_token,
        payload,
      ]),
    )
  ).rows[0].v;
  const second = (
    await worker(() =>
      db.query("select snapshot_announcement_message($1,$2,$3) as v", [
        item.id,
        item.claim_token,
        { ...payload, html: "Changed content" },
      ]),
    )
  ).rows[0].v;
  expect(first).toEqual(second);
  expect(second.html).toBe("<p>Frozen content</p>");
  await actor(async () => {
    await expect(
      db.query("select snapshot_announcement_message($1,$2,$3)", [
        item.id,
        item.claim_token,
        payload,
      ]),
    ).rejects.toThrow();
  });
});
test("ambiguous outcomes older than the provider idempotency window are not retried", async () => {
  const id = await draft();
  const item = await acceptedTest(id);
  await db.query(
    "update private.announcement_recipients set status='failed',accepted_at=null where id=$1",
    [item.id],
  );
  await db.query(
    "update private.announcement_attempts set started_at=now()-interval '25 hours' where recipient_id=$1",
    [item.id],
  );
  expect(
    (await worker(() => db.query("select claim_announcement_emails() as v")))
      .rows[0].v,
  ).toEqual([]);
  expect(
    (
      await db.query(
        "select safe_error from private.announcement_recipients where id=$1",
        [item.id],
      )
    ).rows[0].safe_error,
  ).toContain("operator review");
});
test("revocation after claim is rechecked before an external message can be sent", async () => {
  const id = await draft();
  await preview(id);
  const recipient = (
    await actor(() =>
      db.query("select queue_announcement_test($1) as id", [id]),
    )
  ).rows[0].id;
  const item = (
    await worker(() =>
      db.query("select claim_announcement_emails($1) as v", [recipient]),
    )
  ).rows[0].v[0];
  await db.query(
    "update private.developer_access set active=false where profile_id=$1",
    [ids.admin],
  );
  const value = (
    await worker(() =>
      db.query("select snapshot_announcement_message($1,$2,$3) as v", [
        item.id,
        item.claim_token,
        {
          id: `announcement-${item.id}`,
          to: item.email,
          purpose: "notifications",
          deliveryRef: item.delivery_ref,
        },
      ]),
    )
  ).rows[0].v;
  expect(value).toBeNull();
  expect(
    (
      await db.query(
        "select status from private.announcement_recipients where id=$1",
        [item.id],
      )
    ).rows[0].status,
  ).toBe("skipped");
});
test("provider-confirmed failure arriving before finish remains failed and suppresses a second send", async () => {
  const id = await draft();
  await preview(id);
  const recipient = (
    await actor(() =>
      db.query("select queue_announcement_test($1) as id", [id]),
    )
  ).rows[0].id;
  const item = (
    await worker(() =>
      db.query("select claim_announcement_emails($1) as v", [recipient]),
    )
  ).rows[0].v[0];
  await db.exec("set role anon");
  await db.query(
    "select record_announcement_receipt($1,'early-failed','failed',$2,now())",
    [item.delivery_ref, `provider-${item.id}`],
  );
  await db.exec("reset role");
  await finish(item);
  expect(
    (
      await db.query(
        "select status from private.announcement_recipients where id=$1",
        [item.id],
      )
    ).rows[0].status,
  ).toBe("failed");
  expect(
    (
      await db.query(
        "select test_accepted_hash from developer_announcements where id=$1",
        [id],
      )
    ).rows[0].test_accepted_hash,
  ).toBeNull();
  expect(
    (await worker(() => db.query("select claim_announcement_emails() as v")))
      .rows[0].v,
  ).toEqual([]);
});
test("ordinary users cannot draft, inspect, queue or retry announcements; workers cannot edit content", async () => {
  const id = await draft();
  await actor(async () => {
    await expect(
      db.query("select developer_announcement_audience('everyone')"),
    ).rejects.toThrow();
    await expect(
      db.query("select preview_developer_announcement($1)", [id]),
    ).rejects.toThrow();
    await expect(
      db.query("select retry_developer_announcement($1)", [id]),
    ).rejects.toThrow();
  }, ids.staff);
  await worker(async () => {
    await expect(
      db.query(
        "update developer_announcements set title='tampered' where id=$1",
        [id],
      ),
    ).rejects.toThrow();
  });
});

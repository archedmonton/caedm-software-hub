import { beforeAll, beforeEach, afterAll, test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
let db;
const fields = {
  title: "Export department renewal planning",
  area: "Upcoming Renewals",
  priority: "Normal",
  department: "Mission Services",
  problem:
    "We need to share renewal decisions with our team before the deadline.",
  solution:
    "Add a filtered renewal planning export with owner and decision dates.",
  benefit: "This will reduce manual follow-up and improve planning.",
  workaround: "We currently copy the renewal dates into a separate document.",
};
beforeAll(async () => {
  db = await database();
  await fixtures(db);
}, 60000);
beforeEach(async () => {
  await db.exec(
    "delete from private.rate_limits where key like 'feature-requests:%'",
  );
});
afterAll(async () => {
  await db?.close();
});
async function submit(user = ids.staff, key = randomUUID(), overrides = {}) {
  const v = { ...fields, ...overrides };
  const result = await asUser(db, user, () =>
    db.query(
      "select public.submit_feature_request($1,$2,$3,$4,$5,$6,$7,$8,$9) as receipt",
      [
        key,
        v.title,
        v.area,
        v.priority,
        v.department,
        v.problem,
        v.solution,
        v.benefit,
        v.workaround,
      ],
    ),
  );
  return result.rows[0].receipt;
}
async function service(sql, params) {
  await db.exec("set role service_role");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function claim(id, user = ids.staff) {
  return (
    await service(
      "select public.claim_feature_request_delivery($1,$2) as result",
      [id, user],
    )
  ).rows[0].result;
}
async function finish(id, token, ok) {
  return service("select public.finish_feature_request_delivery($1,$2,$3)", [
    id,
    token,
    ok,
  ]);
}

test("verified active and pending employees can request features without activating pending accounts", async () => {
  for (const user of [ids.admin, ids.finance, ids.staff, ids.pending])
    expect((await submit(user)).id).toBeTruthy();
  await asUser(db, ids.pending, async () => {
    expect(
      (
        await db.query(
          "select id from feature_requests where requester_id=$1",
          [ids.pending],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select id from software_subscriptions")).rows,
    ).toHaveLength(0);
    expect((await db.query("select id from teams")).rows).toHaveLength(0);
  });
  expect(
    (await db.query("select status from profiles where id=$1", [ids.pending]))
      .rows[0].status,
  ).toBe("pending_approval");
});
test("unverified, suspended, deactivated and identity-mismatched accounts cannot submit", async () => {
  await expect(submit(ids.unverified)).rejects.toThrow("verified");
  for (const status of ["suspended", "deactivated", "rejected"]) {
    await db.query("update profiles set status=$2 where id=$1", [
      ids.other,
      status,
    ]);
    await expect(submit(ids.other)).rejects.toThrow("verified");
  }
  await db.query("update profiles set status='active' where id=$1", [
    ids.other,
  ]);
  await db.query("update auth.users set email='changed@caedm.ca' where id=$1", [
    ids.other,
  ]);
  try {
    await expect(submit(ids.other)).rejects.toThrow("verified");
  } finally {
    await db.query("update auth.users set email='other@caedm.ca' where id=$1", [
      ids.other,
    ]);
  }
});
test("requester identity is taken from the verified profile and cannot be supplied by clients", async () => {
  const r = await submit(ids.staff);
  const row = (
    await db.query(
      "select requester_id,requester_email,requester_name from feature_requests where id=$1",
      [r.id],
    )
  ).rows[0];
  expect(row).toEqual({
    requester_id: ids.staff,
    requester_email: "staff@caedm.ca",
    requester_name: "Test staff",
  });
  await asUser(db, ids.staff, async () => {
    await expect(
      db.query(
        "update feature_requests set requester_email='admin@caedm.ca' where id=$1",
        [r.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.query("insert into feature_requests(requester_id) values($1)", [
        ids.admin,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("delete from feature_requests where id=$1", [r.id]),
    ).rejects.toThrow();
  });
});
test("RLS isolates request content, admin review is allowed, delivery claims are never client-readable", async () => {
  const mine = await submit(ids.staff),
    theirs = await submit(ids.other);
  await asUser(db, ids.staff, async () => {
    expect(
      (
        await db.query("select id from feature_requests where id in ($1,$2)", [
          mine.id,
          theirs.id,
        ])
      ).rows,
    ).toEqual([{ id: mine.id }]);
    await expect(
      db.query("select delivery_claim from feature_requests"),
    ).rejects.toThrow();
  });
  await asUser(db, ids.finance, async () => {
    expect(
      (
        await db.query("select id from feature_requests where id in ($1,$2)", [
          mine.id,
          theirs.id,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  await asUser(db, ids.admin, async () => {
    expect(
      (
        await db.query("select id from feature_requests where id in ($1,$2)", [
          mine.id,
          theirs.id,
        ])
      ).rows,
    ).toHaveLength(2);
  });
  await db.exec("set role anon");
  try {
    await expect(db.query("select id from feature_requests")).rejects.toThrow();
    await expect(
      db.query(
        "select public.submit_feature_request($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [randomUUID(), ...Object.values(fields)],
      ),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
test("all client roles are denied privileged email delivery RPCs", async () => {
  for (const user of [ids.admin, ids.staff, ids.pending])
    await asUser(db, user, async () => {
      await expect(
        db.query("select public.pending_feature_request_deliveries()"),
      ).rejects.toThrow();
      await expect(
        db.query("select public.claim_feature_request_delivery($1,$2)", [
          randomUUID(),
          user,
        ]),
      ).rejects.toThrow();
      await expect(
        db.query("select public.finish_feature_request_delivery($1,$2,true)", [
          randomUUID(),
          randomUUID(),
        ]),
      ).rejects.toThrow();
    });
});
test("duplicate form submissions return the same receipt and cannot overwrite content", async () => {
  const key = randomUUID();
  const first = await submit(ids.staff, key);
  const duplicate = await submit(ids.staff, key);
  expect(duplicate.id).toBe(first.id);
  expect(
    (
      await db.query("select hits from private.rate_limits where key=$1", [
        "feature-requests:" + ids.staff,
      ])
    ).rows[0].hits,
  ).toBe(1);
  await expect(
    submit(ids.staff, key, { title: "A different feature request title" }),
  ).rejects.toThrow("different details");
  expect((await submit(ids.other, key)).id).not.toBe(first.id);
});
test("database validates request content and enforces five new requests per hour", async () => {
  for (const change of [
    { title: "short" },
    { title: "Header\r\nBcc: attacker@example.com" },
    { area: "Arbitrary" },
    { priority: "Critical" },
    { problem: "short" },
    { solution: "x".repeat(4001) },
  ])
    await expect(submit(ids.staff, randomUUID(), change)).rejects.toThrow();
  for (let i = 0; i < 5; i++) await submit(ids.staff);
  await expect(submit(ids.staff)).rejects.toThrow("limit reached");
  await db.query(
    "update private.rate_limits set window_start=now()-interval '2 hours' where key=$1",
    ["feature-requests:" + ids.staff],
  );
  expect((await submit(ids.staff)).id).toBeTruthy();
});
test("delivery claims require the correct requester, serialize sends and reject stale finishes", async () => {
  const r = await submit();
  await expect(claim(r.id, ids.other)).rejects.toThrow("unavailable");
  const c = await claim(r.id);
  expect(c.status).toBe("claimed");
  expect((await claim(r.id)).status).toBe("sending");
  await expect(finish(r.id, randomUUID(), true)).rejects.toThrow(
    "claim changed",
  );
  await finish(r.id, c.claim, true);
  expect((await claim(r.id)).status).toBe("sent");
  await expect(finish(r.id, c.claim, true)).rejects.toThrow("claim changed");
});
test("failed emails preserve requests and retries have a cooldown and maximum attempts", async () => {
  const r = await submit();
  const c = await claim(r.id);
  await finish(r.id, c.claim, false);
  expect(
    (
      await db.query(
        "select delivery_status,problem from feature_requests where id=$1",
        [r.id],
      )
    ).rows[0],
  ).toEqual({ delivery_status: "failed", problem: fields.problem });
  await expect(claim(r.id)).rejects.toThrow("Wait one minute");
  await db.query(
    "update feature_requests set last_attempt_at=now()-interval '2 minutes',delivery_attempts=4 where id=$1",
    [r.id],
  );
  const last = await claim(r.id);
  await finish(r.id, last.claim, false);
  await db.query(
    "update feature_requests set last_attempt_at=now()-interval '2 minutes' where id=$1",
    [r.id],
  );
  expect((await claim(r.id)).status).toBe("failed");
  expect(
    (
      await db.query(
        "select delivery_attempts from feature_requests where id=$1",
        [r.id],
      )
    ).rows[0].delivery_attempts,
  ).toBe(5);
});
test("expired leases can recover and deactivation prevents subsequent delivery", async () => {
  const r = await submit(ids.other);
  const old = await claim(r.id, ids.other);
  await db.query(
    "update feature_requests set delivery_until=now()-interval '1 minute',last_attempt_at=now()-interval '6 minutes' where id=$1",
    [r.id],
  );
  const next = await claim(r.id, ids.other);
  expect(next.claim).not.toBe(old.claim);
  await expect(finish(r.id, old.claim, true)).rejects.toThrow("claim changed");
  await finish(r.id, next.claim, false);
  await db.query("update profiles set status='suspended' where id=$1", [
    ids.other,
  ]);
  try {
    await expect(claim(r.id, ids.other)).rejects.toThrow("restricted");
    await asUser(db, ids.other, async () => {
      expect(
        (await db.query("select id from feature_requests where id=$1", [r.id]))
          .rows,
      ).toHaveLength(0);
    });
  } finally {
    await db.query("update profiles set status='active' where id=$1", [
      ids.other,
    ]);
  }
});
test("audit activity does not leak feature text, requester contact or delivery secrets", async () => {
  const r = await submit();
  const c = await claim(r.id);
  const audit = JSON.stringify(
    (
      await db.query(
        "select before_data,after_data from audit_logs where entity='feature_requests' and record_id=$1",
        [r.id],
      )
    ).rows,
  );
  for (const secret of [
    fields.title,
    fields.problem,
    "staff@caedm.ca",
    c.claim,
    "delivery_claim",
    "request_key",
  ])
    expect(audit).not.toContain(secret);
});
test("employees can queue only their own retries without acknowledging SMTP success", async () => {
  const r = await submit(ids.pending);
  const c = await claim(r.id, ids.pending);
  await finish(r.id, c.claim, false);
  await asUser(db, ids.staff, async () => {
    await expect(
      db.query("select public.retry_feature_request_email($1)", [r.id]),
    ).rejects.toThrow("unavailable");
  });
  await asUser(db, ids.pending, async () => {
    await expect(
      db.query("select public.retry_feature_request_email($1)", [r.id]),
    ).rejects.toThrow("Wait one minute");
  });
  await db.query(
    "update feature_requests set last_attempt_at=now()-interval '2 minutes' where id=$1",
    [r.id],
  );
  await asUser(db, ids.pending, async () => {
    expect(
      (
        await db.query(
          "select public.retry_feature_request_email($1) as result",
          [r.id],
        )
      ).rows[0].result.status,
    ).toBe("pending");
  });
  expect(
    (
      await db.query(
        "select delivery_status,delivery_attempts,email_sent_at from feature_requests where id=$1",
        [r.id],
      )
    ).rows[0],
  ).toEqual({
    delivery_status: "pending",
    delivery_attempts: 1,
    email_sent_at: null,
  });
  await db.query(
    "update feature_requests set delivery_attempts=5 where id=$1",
    [r.id],
  );
  await asUser(db, ids.pending, async () => {
    await expect(
      db.query("select public.retry_feature_request_email($1)", [r.id]),
    ).rejects.toThrow("retry limit");
  });
});
test("scheduled batches are bounded, honor backoff and omit ineligible accounts or completed requests", async () => {
  // Isolate this queue test from requests created by preceding tests.
  await db.exec("update feature_requests set delivery_status='sent'");
  const mine = await submit(ids.staff),
    pending = await submit(ids.pending),
    blocked = await submit(ids.other);
  await db.query("update profiles set status='suspended' where id=$1", [
    ids.other,
  ]);
  try {
    const selected = async () =>
      (
        await service(
          "select * from public.pending_feature_request_deliveries()",
          [],
        )
      ).rows.map((r) => r.id);
    expect(await selected()).toEqual(
      expect.arrayContaining([mine.id, pending.id]),
    );
    expect(await selected()).not.toContain(blocked.id);
    const c = await claim(mine.id);
    await finish(mine.id, c.claim, false);
    expect(await selected()).not.toContain(mine.id);
    await db.query(
      "update feature_requests set last_attempt_at=now()-interval '6 minutes' where id=$1",
      [mine.id],
    );
    expect(await selected()).toContain(mine.id);
    // A crash on the final attempt must settle as failed, rather than show Sending forever.
    await db.query(
      "update feature_requests set delivery_status='sending',delivery_attempts=5,delivery_until=now()-interval '1 minute',last_attempt_at=now()-interval '6 minutes' where id=$1",
      [mine.id],
    );
    expect(await selected()).toContain(mine.id);
    expect((await claim(mine.id)).status).toBe("failed");
    expect(await selected()).not.toContain(mine.id);
    for (let i = 0; i < 4; i++) await submit(ids.finance);
    expect(await selected()).toHaveLength(3);
  } finally {
    await db.query("update profiles set status='active' where id=$1", [
      ids.other,
    ]);
  }
});

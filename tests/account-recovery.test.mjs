import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  test,
  expect,
} from "vitest";
import { randomUUID, createHash } from "node:crypto";
import {
  database,
  fixtures,
  asUser,
  ids,
  recoverRejectedStatements,
} from "./db-helper.mjs";
let db;
const sessionId = randomUUID();
const hash = "a".repeat(64);
async function signed(id, fn, extra = {}) {
  return asUser(db, id, async () => {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: id,
        session_id: sessionId,
        aal: "aal1",
        amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
        ...extra,
      }),
    ]);
    try {
      return await fn();
    } finally {
      await db.exec("select set_config('request.jwt.claims','',false)");
    }
  });
}
async function issue() {
  return signed(ids.admin, async () => {
    const r = (
      await db.query("select begin_account_recovery($1) as r", [ids.staff])
    ).rows[0].r;
    await db.query("select bind_account_recovery($1,$2,$3)", [
      r.id,
      createHash("md5").update(hash).digest("hex"),
      "v1.abcdefghijklmnop.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvabcdefghijklmnopqrstuv",
    ]);
    return r;
  });
}
beforeAll(async () => {
  db = await database();
  await fixtures(db);
  await db.query("update profiles set role='super_admin' where id=$1", [
    ids.admin,
  ]);
  recoverRejectedStatements(db);
}, 30000);
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("rollback"));
afterAll(() => db.close());
test.each(["finance", "staff", "pending", "unverified"])(
  "%s cannot list or initiate recovery directly",
  async (role) => {
    await signed(ids[role], async () => {
      await expect(
        db.query("select account_recovery_console()"),
      ).rejects.toThrow(/access required/);
      await expect(
        db.query("select begin_account_recovery($1)", [ids.other]),
      ).rejects.toThrow(/access required/);
    });
  },
);
test("Super Admin without Developer designation can recover an ordinary verified account", async () => {
  const r = await issue();
  expect(r.email).toBe("staff@caedm.ca");
  expect(
    (
      await db.query("select role,status from profiles where id=$1", [
        ids.staff,
      ])
    ).rows[0],
  ).toEqual({ role: "staff", status: "active" });
  await signed(ids.admin, async () => {
    const d = (await db.query("select account_recovery_console() as d")).rows[0]
      .d;
    expect(d.people.find((p) => p.id === ids.staff).pending).toBe(true);
    expect(JSON.stringify(d)).not.toContain(hash);
  });
});
test("fresh authentication and enrolled MFA are enforced inside PostgreSQL", async () => {
  await signed(
    ids.admin,
    async () => {
      await expect(
        db.query("select begin_account_recovery($1)", [ids.staff]),
      ).rejects.toThrow(/Fresh password/);
    },
    { amr: [] },
  );
  await db.query(
    "insert into auth.mfa_factors(user_id,status) values($1,'verified')",
    [ids.admin],
  );
  await signed(ids.admin, async () => {
    await expect(
      db.query("select begin_account_recovery($1)", [ids.staff]),
    ).rejects.toThrow(/MFA/);
  });
  await signed(
    ids.admin,
    async () => {
      expect(
        (await db.query("select begin_account_recovery($1) as r", [ids.staff]))
          .rows[0].r.id,
      ).toBeTruthy();
    },
    { aal: "aal2" },
  );
});
test("self, Super Admin, Developer, unverified and pending targets are rejected", async () => {
  await db.query(
    "insert into private.developer_access(profile_id) values($1)",
    [ids.finance],
  );
  await signed(ids.admin, async () => {
    for (const id of [ids.admin, ids.finance, ids.pending, ids.unverified])
      await expect(
        db.query("select begin_account_recovery($1)", [id]),
      ).rejects.toThrow(/eligible/);
  });
  await db.query(
    "insert into auth.mfa_factors(user_id,status) values($1,'verified')",
    [ids.other],
  );
  await signed(ids.admin, async () => {
    await expect(
      db.query("select begin_account_recovery($1)", [ids.other]),
    ).rejects.toThrow(/eligible/);
  });
});
test("independently designated Developer may recover ordinary employees but never during preview", async () => {
  await db.query(
    "insert into private.developer_access(profile_id) values($1)",
    [ids.finance],
  );
  await signed(ids.finance, async () => {
    await db.query("select start_role_preview('staff')");
    await expect(
      db.query("select begin_account_recovery($1)", [ids.staff]),
    ).rejects.toThrow(/outside role preview/);
    await db.query("select end_role_preview()");
    expect(
      (await db.query("select begin_account_recovery($1) as r", [ids.staff]))
        .rows[0].r.id,
    ).toBeTruthy();
  });
});
test("unprepared, wrong, expired, replaced, revoked-issuer and completed capabilities fail closed", async () => {
  const r = await issue();
  expect(
    (
      await db.query("select validate_account_recovery($1,$2) as id", [
        r.id,
        hash,
      ])
    ).rows[0].id,
  ).toBe(ids.staff);
  expect(
    (
      await db.query("select validate_account_recovery($1,$2) as id", [
        r.id,
        "b".repeat(64),
      ])
    ).rows[0].id,
  ).toBeNull();
  await db.query(
    "update private.account_recoveries set expires_at=now()-interval '1 minute' where id=$1",
    [r.id],
  );
  expect(
    (
      await db.query("select validate_account_recovery($1,$2) as id", [
        r.id,
        hash,
      ])
    ).rows[0].id,
  ).toBeNull();
  await db.query(
    "update private.account_recoveries set expires_at=now()+interval '15 minutes' where id=$1",
    [r.id],
  );
  await db.query("update profiles set role='super_admin' where id=$1", [
    ids.finance,
  ]);
  await db.query("update profiles set role='admin' where id=$1", [ids.admin]);
  expect(
    (
      await db.query("select validate_account_recovery($1,$2) as id", [
        r.id,
        hash,
      ])
    ).rows[0].id,
  ).toBeNull();
});
test("pending recovery blocks real business RLS; new password requires a fresh session and invalidates link", async () => {
  const r = await issue();
  await signed(ids.staff, async () => {
    expect(
      (await db.query("select get_access_context() as a")).rows[0].a,
    ).toMatchObject({ effective_role: null, recovery_required: true });
    expect(
      (await db.query("select count(*)::int n from software_subscriptions"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (await db.query("select private.can_request_features() as allowed"))
        .rows[0].allowed,
    ).toBe(false);
  });
  await db.query(
    "insert into auth.sessions(id,user_id,created_at) values($1,$2,now()-interval '1 hour')",
    [sessionId, ids.staff],
  );
  await db.query(
    "update auth.users set encrypted_password='new-synthetic-hash' where id=$1",
    [ids.staff],
  );
  expect(
    (
      await db.query("select validate_account_recovery($1,$2) as id", [
        r.id,
        hash,
      ])
    ).rows[0].id,
  ).toBeNull();
  await signed(ids.staff, async () => {
    expect(
      (await db.query("select get_access_context() as a")).rows[0].a
        .recovery_required,
    ).toBe(true);
  });
  await db.query(
    "update auth.sessions set created_at=clock_timestamp()+interval '1 second' where id=$1",
    [sessionId],
  );
  await signed(ids.staff, async () => {
    expect(
      (await db.query("select get_access_context() as a")).rows[0].a,
    ).toMatchObject({ effective_role: "staff", recovery_required: false });
    expect(
      (await db.query("select count(*)::int n from software_subscriptions"))
        .rows[0].n,
    ).toBeGreaterThan(0);
  });
});
test("reissue rate limit, single binding and audit exclude tokens", async () => {
  const r = await issue();
  await signed(ids.admin, async () => {
    await expect(
      db.query("select begin_account_recovery($1)", [ids.staff]),
    ).rejects.toThrow(/Wait one minute/);
    await expect(
      db.query("select bind_account_recovery($1,$2,$3)", [
        r.id,
        "c".repeat(32),
        "v1.abcdefghijklmnop.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvabcdefghijklmnopqrstuv",
      ]),
    ).rejects.toThrow(/superseded/);
  });
  const audit = (
    await db.query(
      "select action,detail from private.developer_audit where subject_id=$1",
      [ids.staff],
    )
  ).rows;
  expect(audit.map((a) => a.action)).toEqual([
    "account_recovery_started",
    "account_recovery_prepared",
  ]);
  expect(JSON.stringify(audit)).not.toContain(hash);
});
test("only the recovery worker can read ciphertext and concurrent redemption/reissue is leased", async () => {
  const r = await issue();
  await signed(ids.staff, async () => {
    await expect(
      db.query("select claim_account_recovery($1,$2)", [r.id, hash]),
    ).rejects.toThrow(/permission denied/);
  });
  expect(
    (await db.query("select claim_account_recovery($1,$2) as c", [r.id, hash]))
      .rows[0].c.sealed_token,
  ).toMatch(/^v1\./);
  expect(
    (await db.query("select claim_account_recovery($1,$2) as c", [r.id, hash]))
      .rows[0].c,
  ).toBeNull();
  await db.query(
    "update private.account_recoveries set started_at=now()-interval '2 minutes' where id=$1",
    [r.id],
  );
  await signed(ids.admin, async () => {
    await expect(
      db.query("select begin_account_recovery($1)", [ids.staff]),
    ).rejects.toThrow(/in progress/);
  });
});

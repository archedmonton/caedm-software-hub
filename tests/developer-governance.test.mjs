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
const sessionId = randomUUID();
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
beforeAll(async () => {
  db = await database();
  await fixtures(db);
  await db.query("update profiles set role='super_admin' where id=$1", [
    ids.admin,
  ]);
  await db.query(
    "insert into private.developer_protection(profile_id) values($1)",
    [ids.admin],
  );
  await db.query("select private.bootstrap_developer_access($1)", [ids.admin]);
  recoverRejectedStatements(db);
}, 60000);
beforeEach(async () => {
  await db.exec("begin; delete from private.rate_limits");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});
test("operator bootstrap pins the existing identity without changing organization roles", async () => {
  expect(
    (await db.query("select role from profiles where id=$1", [ids.admin]))
      .rows[0].role,
  ).toBe("super_admin");
  expect(
    (await db.query("select primary_id from private.developer_governance"))
      .rows[0].primary_id,
  ).toBe(ids.admin);
  await signed(ids.staff, async () => {
    await expect(
      db.query("select private.bootstrap_developer_access($1)", [ids.staff]),
    ).rejects.toThrow();
  });
});
test.each(["admin", "finance", "staff"])(
  "Super Admin can preview %s without changing identity or profile",
  async (role) => {
    await signed(ids.admin, async () => {
      await db.query("select start_role_preview($1)", [role]);
      const value = (await db.query("select get_access_context() as value"))
        .rows[0].value;
      expect(value).toMatchObject({
        actual_role: "super_admin",
        effective_role: role,
        tools_allowed: false,
        preview_role: role,
      });
      expect((await db.query("select auth.uid() as id")).rows[0].id).toBe(
        ids.admin,
      );
      expect(
        (await db.query("select role from profiles where id=$1", [ids.admin]))
          .rows[0].role,
      ).toBe("super_admin");
      await expect(db.query("select developer_directory()")).rejects.toThrow(
        /Developer authorization/,
      );
    });
  },
);
test("preview narrows RLS reads and direct financial writes", async () => {
  await signed(ids.admin, async () => {
    expect(
      (await db.query("select count(*)::int as n from software_subscriptions"))
        .rows[0].n,
    ).toBeGreaterThan(0);
    await db.query("select start_role_preview('staff')");
    expect(
      (await db.query("select count(*)::int as n from software_subscriptions"))
        .rows[0].n,
    ).toBe(0);
    await expect(
      db.query("insert into vendors(name) values('Preview forbidden vendor')"),
    ).rejects.toThrow();
  });
});
test("financial mutations retain actual actor and preview audit context", async () => {
  await signed(ids.admin, async () => {
    await db.query("select start_role_preview('finance')");
    await db.query(
      "insert into vendors(name) values('Preview audited vendor')",
    );
  });
  const row = (
    await db.query(
      "select actor_id,context from audit_logs where entity='vendors' order by created_at desc limit 1",
    )
  ).rows[0];
  expect(row.actor_id).toBe(ids.admin);
  expect(row.context).toMatchObject({
    actual_role: "super_admin",
    preview_role: "finance",
    real_actor_id: ids.admin,
  });
});
test("Admin preview cannot grant Super Admin despite the actor's actual role", async () => {
  await signed(ids.admin, async () => {
    await db.query("select start_role_preview('admin')");
    await expect(
      db.query("update profiles set role='super_admin' where id=$1", [
        ids.staff,
      ]),
    ).rejects.toThrow(/Only a Super Admin/);
  });
});
test("the database application MFA policy is enforced on direct access-change RPCs", async () => {
  await db.exec("update private.developer_governance set require_mfa=true");
  await signed(ids.admin, async () => {
    await expect(
      db.query("select change_developer_access($1,true)", [ids.staff]),
    ).rejects.toThrow(/MFA/);
  });
});
test("role query/header claims cannot expand preview or change trusted profile role", async () => {
  await db.query(
    "insert into private.developer_access(profile_id) values($1)",
    [ids.staff],
  );
  await signed(
    ids.staff,
    async () => {
      await expect(
        db.query("select start_role_preview('super_admin')"),
      ).rejects.toThrow(/not permitted/);
    },
    { role: "super_admin", preview_role: "super_admin" },
  );
});
test("preview is bound to the signed-in session and exit restores actual access", async () => {
  await signed(ids.admin, () => db.query("select start_role_preview('staff')"));
  await signed(
    ids.admin,
    async () => {
      expect(
        (await db.query("select get_access_context() as v")).rows[0].v
          .preview_role,
      ).toBeNull();
    },
    { session_id: randomUUID() },
  );
  await signed(ids.admin, async () => {
    await db.query("select end_role_preview()");
    expect(
      (await db.query("select get_access_context() as v")).rows[0].v
        .effective_role,
    ).toBe("super_admin");
  });
});
test("expired preview restores actual view, while revocation fails closed until exit", async () => {
  await signed(ids.admin, () => db.query("select start_role_preview('staff')"));
  await db.query(
    "update private.developer_access set active=false where profile_id=$1",
    [ids.admin],
  );
  await signed(ids.admin, async () => {
    expect(
      (await db.query("select get_access_context() as v")).rows[0].v
        .effective_role,
    ).toBeNull();
    await db.query("select end_role_preview()");
  });
  await db.query(
    "update private.developer_access set active=true where profile_id=$1",
    [ids.admin],
  );
  await signed(ids.admin, () => db.query("select start_role_preview('staff')"));
  await db.exec(
    "update private.role_previews set expires_at=now()-interval '1 minute'",
  );
  await signed(ids.admin, async () => {
    expect(
      (await db.query("select get_access_context() as v")).rows[0].v
        .preview_role,
    ).toBeNull();
  });
});
test("grants require fresh password proof and leave organizational role unchanged", async () => {
  await signed(
    ids.admin,
    async () => {
      await expect(
        db.query("select change_developer_access($1,true)", [ids.staff]),
      ).rejects.toThrow(/Fresh password/);
    },
    { amr: [] },
  );
  await signed(ids.admin, () =>
    db.query("select change_developer_access($1,true)", [ids.staff]),
  );
  expect(
    (await db.query("select role from profiles where id=$1", [ids.staff]))
      .rows[0].role,
  ).toBe("staff");
  expect(
    (
      await db.query(
        "select kind from private.developer_security_emails order by created_at desc limit 1",
      )
    ).rows[0].kind,
  ).toBe("developer_granted");
  await signed(ids.staff, async () => {
    expect(
      (await db.query("select developer_directory() as v")).rows[0].v.people
        .length,
    ).toBeGreaterThan(0);
  });
});
test("stale password, enrolled MFA without aal2, pending and own grants are denied", async () => {
  await signed(
    ids.admin,
    async () => {
      await expect(
        db.query("select change_developer_access($1,true)", [ids.staff]),
      ).rejects.toThrow(/Fresh password/);
    },
    {
      amr: [
        { method: "password", timestamp: Math.floor(Date.now() / 1000) - 200 },
      ],
    },
  );
  await db.query(
    "insert into auth.mfa_factors(user_id,status) values($1,'verified')",
    [ids.admin],
  );
  await signed(ids.admin, async () => {
    await expect(
      db.query("select change_developer_access($1,true)", [ids.staff]),
    ).rejects.toThrow(/MFA/);
  });
  await signed(
    ids.admin,
    async () => {
      await expect(
        db.query("select change_developer_access($1,true)", [ids.pending]),
      ).rejects.toThrow(/not permitted/);
      await expect(
        db.query("select change_developer_access($1,false)", [ids.admin]),
      ).rejects.toThrow(/not permitted/);
    },
    { aal: "aal2" },
  );
});
test("a secondary Developer cannot revoke the primary or themselves", async () => {
  await signed(ids.admin, () =>
    db.query("select change_developer_access($1,true)", [ids.staff]),
  );
  await signed(ids.staff, async () => {
    for (const id of [ids.admin, ids.staff])
      await expect(
        db.query("select change_developer_access($1,false)", [id]),
      ).rejects.toThrow(/not permitted/);
  });
});
test("security notices use bounded service-only claims and retain acceptance separately from delivery", async () => {
  await signed(ids.admin, () =>
    db.query("select change_developer_access($1,true)", [ids.staff]),
  );
  await signed(ids.staff, async () => {
    await expect(
      db.query("select claim_developer_security_emails()"),
    ).rejects.toThrow();
  });
  await db.exec("set role service_role");
  const item = (await db.query("select claim_developer_security_emails() as v"))
    .rows[0].v[0];
  expect(item.kind).toBe("developer_granted");
  expect(
    (
      await db.query(
        "select finish_developer_security_email($1,$2,true) as v",
        [item.id, item.claim_token],
      )
    ).rows[0].v,
  ).toBe(true);
  await db.exec("reset role");
  expect(
    (
      await db.query(
        "select status from private.developer_security_emails where id=$1",
        [item.id],
      )
    ).rows[0].status,
  ).toBe("accepted");
});
test("handover requires operator approval and verified successor access; preserves roles and both assignments", async () => {
  await signed(ids.admin, () =>
    db.query("select change_developer_access($1,true)", [ids.staff]),
  );
  await signed(ids.admin, async () => {
    await expect(
      db.query("select confirm_developer_handover($1)", [ids.staff]),
    ).rejects.toThrow(/handover/);
  });
  await db.query("select private.authorize_developer_handover($1)", [
    ids.staff,
  ]);
  await signed(ids.admin, async () => {
    await expect(
      db.query("select confirm_developer_handover($1)", [ids.staff]),
    ).rejects.toThrow(/Successor/);
  });
  await signed(ids.staff, () => db.query("select visit_developer_tools()"));
  await signed(ids.admin, () =>
    db.query("select confirm_developer_handover($1)", [ids.staff]),
  );
  expect(
    (await db.query("select primary_id from private.developer_governance"))
      .rows[0].primary_id,
  ).toBe(ids.staff);
  expect(
    (
      await db.query(
        "select count(*)::int as n from private.developer_access where active",
      )
    ).rows[0].n,
  ).toBe(2);
  expect(
    (await db.query("select role from profiles where id=$1", [ids.staff]))
      .rows[0].role,
  ).toBe("staff");
});
test("ordinary staff, Finance and Admin without designation cannot access developer RPCs or records", async () => {
  for (const id of [ids.staff, ids.finance])
    await signed(id, async () => {
      await expect(db.query("select developer_directory()")).rejects.toThrow();
      await expect(
        db.query("select developer_email_activity()"),
      ).rejects.toThrow();
      expect(
        (await db.query("select * from developer_announcements")).rows,
      ).toEqual([]);
      await expect(
        db.query("select * from private.developer_access"),
      ).rejects.toThrow();
    });
});

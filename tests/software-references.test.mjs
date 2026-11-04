import { beforeAll, afterAll, beforeEach, test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { database, fixtures, asUser, ids } from "./db-helper.mjs";
const department = "10000000-0000-4000-8000-000000000001";
const otherDepartment = "10000000-0000-4000-8000-000000000002";
const root = "a2000000-0000-4000-8000-000000000001";
let db;
beforeAll(async () => {
  db = await database();
  await fixtures(db);
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'ruban.peppin@caedm.ca',now(),'{\"full_name\":\"Developer fixture\"}')",
    [root],
  );
  await db.query("update profiles set status='active' where id=$1", [root]);
  await db.exec("select private.bootstrap_developer_super_admin()");
}, 60000);
beforeEach(async () => {
  await db.exec("delete from private.rate_limits");
});
afterAll(async () => {
  await db?.close();
});
test("category RLS permits active reads and Finance creation but denies Staff, pending, unverified and anonymous writes", async () => {
  await asUser(db, ids.staff, async () => {
    expect(
      (await db.query("select name from software_categories")).rows.length,
    ).toBeGreaterThan(0);
    await expect(
      db.query("insert into software_categories(name) values('Staff bypass')"),
    ).rejects.toThrow();
  });
  await asUser(db, ids.finance, () =>
    db.query(
      "insert into software_categories(name) values('Finance category')",
    ),
  );
  for (const id of [ids.pending, ids.unverified])
    await asUser(db, id, async () => {
      expect(
        (await db.query("select * from software_categories")).rows,
      ).toHaveLength(0);
      await expect(
        db.query(
          "insert into software_categories(name) values('Pending bypass')",
        ),
      ).rejects.toThrow();
    });
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(
        db.query("select * from software_categories"),
      ).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  }
});
test("category constraints reject case-duplicate and blank names without changing existing records", async () => {
  await asUser(db, ids.finance, async () => {
    await expect(
      db.query("insert into software_categories(name) values('productivity')"),
    ).rejects.toThrow();
    for (const name of ["", " ", "x".repeat(81)])
      await expect(
        db.query("insert into software_categories(name) values($1)", [name]),
      ).rejects.toThrow();
  });
});

test("PostgreSQL rejects normalized duplicate vendor and department inserts and renames without changing existing IDs", async () => {
  await asUser(db, ids.admin, async () => {
    for (const table of ["vendors", "teams"]) {
      const name = `Original ${table} %_`;
      const original = (
        await db.query(
          `insert into ${table}(name) values($1) returning id,name`,
          [name],
        )
      ).rows[0];
      for (const variant of [
        name,
        name.toUpperCase(),
        `  ${name.toLowerCase()}  `,
      ])
        await expect(
          db.query(`insert into ${table}(name) values($1)`, [variant]),
        ).rejects.toMatchObject({ code: "23505" });
      const another = (
        await db.query(`insert into ${table}(name) values($1) returning id`, [
          `Another ${table}`,
        ])
      ).rows[0];
      await expect(
        db.query(`update ${table} set name=$1 where id=$2`, [
          name.toLowerCase(),
          another.id,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      expect(
        (
          await db.query(`select id,name from ${table} where id=$1`, [
            original.id,
          ])
        ).rows[0],
      ).toEqual(original);
    }
  });
});

test("payment nicknames reject case and space variants within a department while allowing the same name elsewhere", async () => {
  await asUser(db, ids.finance, async () => {
    await db.query(
      "insert into payment_methods(team_id,nickname) values($1,'Unique procurement')",
      [department],
    );
    await expect(
      db.query(
        "insert into payment_methods(team_id,nickname) values($1,'  UNIQUE PROCUREMENT  ')",
        [department],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const separate = (
      await db.query(
        "insert into payment_methods(team_id,nickname) values($1,'UNIQUE PROCUREMENT') returning id",
        [otherDepartment],
      )
    ).rows[0];
    await expect(
      db.query("update payment_methods set team_id=$1 where id=$2", [
        department,
        separate.id,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

test("duplicate migration preserves historical names, expense rows and existing case variants", async () => {
  const upgrade = await database({ beforeVersion: "202611040001" });
  try {
    await fixtures(upgrade);
    await upgrade.query(
      "insert into vendors(name) values('Legacy Vendor'),('legacy vendor')",
    );
    await upgrade.query(
      "insert into teams(name) values('Legacy Team'),('legacy team')",
    );
    await asUser(upgrade, ids.finance, () =>
      upgrade.exec(
        "insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference) select id,current_date,20,1,'CAD','DUPLICATE-UPGRADE' from software_subscriptions order by id limit 1",
      ),
    );
    const snapshot = async () => ({
      vendors: (await upgrade.query("select * from vendors order by id")).rows,
      teams: (await upgrade.query("select * from teams order by id")).rows,
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
        "supabase/migrations/202611040001_reference_duplicates.sql",
        "utf8",
      ),
    );
    expect(await snapshot()).toEqual(before);
    await expect(
      upgrade.query("insert into vendors(name) values(' LEGACY VENDOR ')"),
    ).rejects.toMatchObject({ code: "23505" });
    // An unchanged legacy spelling remains editable without forcing a merge.
    await upgrade.query(
      "update vendors set name=name where lower(name)='legacy vendor'",
    );
  } finally {
    await upgrade.close();
  }
}, 30000);
test("only administrators can discover eligible employees; protected, pending and unverified accounts are omitted", async () => {
  const rows = await asUser(db, ids.admin, () =>
    db.query("select * from software_employee_candidates()"),
  );
  const candidates = rows.rows.map((r) => r.id);
  expect(candidates).toContain(ids.staff);
  expect(candidates).toContain(ids.other);
  for (const id of [ids.pending, ids.unverified, root])
    expect(candidates).not.toContain(id);
  for (const id of [ids.finance, ids.staff, ids.pending, ids.unverified])
    await asUser(db, id, () =>
      expect(
        db.query("select * from software_employee_candidates()"),
      ).rejects.toThrow(),
    );
});
test("administrator assignment grants View access and rejects duplicate membership without changing Manage permission", async () => {
  const rows = await asUser(db, ids.admin, () =>
    db.query("select * from assign_software_employee($1,$2)", [
      department,
      ids.other,
    ]),
  );
  expect(rows.rows[0]).toMatchObject({ id: ids.other, can_manage: false });
  expect(
    (
      await db.query("select role,status from profiles where id=$1", [
        ids.other,
      ])
    ).rows[0],
  ).toEqual({ role: "staff", status: "active" });
  await asUser(db, ids.admin, () =>
    expect(
      db.query("select * from assign_software_employee($1,$2)", [
        otherDepartment,
        ids.other,
      ]),
    ).rejects.toMatchObject({ code: "23505" }),
  );
  expect(
    (
      await db.query(
        "select can_manage from team_members where team_id=$1 and profile_id=$2",
        [otherDepartment, ids.other],
      )
    ).rows[0].can_manage,
  ).toBe(true);
  await asUser(db, ids.admin, () =>
    expect(
      db.query("select * from assign_software_employee($1,$2)", [
        department,
        ids.other,
      ]),
    ).rejects.toMatchObject({ code: "23505" }),
  );
});
test("direct RPC calls cannot bypass role, verification, department or protected developer guards", async () => {
  for (const actor of [ids.finance, ids.staff, ids.pending, ids.unverified])
    await asUser(db, actor, () =>
      expect(
        db.query("select * from assign_software_employee($1,$2)", [
          department,
          ids.other,
        ]),
      ).rejects.toThrow(),
    );
  for (const target of [ids.pending, ids.unverified, root])
    await asUser(db, ids.admin, () =>
      expect(
        db.query("select * from assign_software_employee($1,$2)", [
          department,
          target,
        ]),
      ).rejects.toThrow(),
    );
  await asUser(db, ids.admin, () =>
    expect(
      db.query("select * from assign_software_employee($1,$2)", [
        randomUUID(),
        ids.staff,
      ]),
    ).rejects.toThrow(),
  );
});
test("revoked verification removes owner eligibility even when a stale profile remains active", async () => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    ids.other,
  ]);
  try {
    await asUser(db, ids.admin, async () => {
      expect(
        (
          await db.query("select * from software_employee_candidates()")
        ).rows.map((r) => r.id),
      ).not.toContain(ids.other);
      await expect(
        db.query("select * from assign_software_employee($1,$2)", [
          department,
          ids.other,
        ]),
      ).rejects.toThrow();
      expect(
        (
          await db.query("select private.owner_valid($1,$2) as valid", [
            department,
            ids.other,
          ])
        ).rows[0].valid,
      ).toBe(false);
    });
  } finally {
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [ids.other],
    );
  }
});
test("Super Admin retains Finance category and administrator membership capabilities", async () => {
  await asUser(db, root, async () => {
    await db.query(
      "insert into software_categories(name) values('Super Admin category')",
    );
    expect(
      (
        await db.query("select * from assign_software_employee($1,$2)", [
          department,
          ids.finance,
        ])
      ).rows[0].id,
    ).toBe(ids.finance);
  });
});
test("upgrade backfills existing categories while preserving software, expense snapshots and historical spelling", async () => {
  const upgrade = await database({ beforeVersion: "202611020001" });
  try {
    await fixtures(upgrade);
    await asUser(upgrade, ids.finance, () =>
      upgrade.exec(
        "insert into expense_records(subscription_id,transaction_date,amount,tax,currency,invoice_reference) select id,current_date,19.95,1,'CAD','UPGRADE-PRESERVATION' from software_subscriptions order by id limit 1",
      ),
    );
    const software = (
      await upgrade.query("select * from software_subscriptions order by id")
    ).rows;
    const expenses = (
      await upgrade.query("select * from expense_records order by id")
    ).rows;
    await upgrade.exec(
      await readFile(
        "supabase/migrations/202611020001_software_editor_references.sql",
        "utf8",
      ),
    );
    expect(
      (await upgrade.query("select * from software_subscriptions order by id"))
        .rows,
    ).toEqual(software);
    expect(
      (await upgrade.query("select * from expense_records order by id")).rows,
    ).toEqual(expenses);
    const names = (
      await upgrade.query("select name from software_categories")
    ).rows.map((r) => r.name);
    for (const row of software) expect(names).toContain(row.category);
  } finally {
    await upgrade.close();
  }
}, 30000);

import { test, expect } from "vitest";
import { adminRole, financeRole, roles, type Profile } from "@/lib/domain";
import { canManageAccount } from "@/lib/account-permissions";
import { visibleHelpArticles, roleCapabilities } from "@/lib/help-content";
const person = (
  id: string,
  role: Profile["role"],
  status = "active",
): Profile => ({
  id,
  role,
  status,
  full_name: "Test employee",
  email: "employee@caedm.ca",
});
test("the hierarchy includes Super Admin in ordinary administration and Finance capabilities", () => {
  expect(roles).toEqual(["super_admin", "admin", "finance", "staff"]);
  for (const role of roles) {
    expect(adminRole(role)).toBe(["super_admin", "admin"].includes(role));
    expect(financeRole(role)).toBe(role !== "staff");
  }
});
test("ordinary Admin cannot manage a Super Admin and delegated Super Admin cannot manage the protected developer", () => {
  const owner = person("owner", "super_admin"),
    delegated = person("delegated", "super_admin"),
    admin = person("admin", "admin");
  expect(canManageAccount(admin, delegated, owner.id)).toBe(false);
  expect(canManageAccount(admin, owner, owner.id)).toBe(false);
  expect(canManageAccount(delegated, owner, owner.id)).toBe(false);
  expect(canManageAccount(owner, delegated, owner.id)).toBe(true);
  expect(canManageAccount(owner, owner, owner.id)).toBe(true);
  expect(canManageAccount(admin, person("staff", "staff"), owner.id)).toBe(
    true,
  );
  expect(
    canManageAccount(
      person("suspended", "super_admin", "suspended"),
      admin,
      owner.id,
    ),
  ).toBe(false);
  expect(canManageAccount(person("finance", "finance"), admin, owner.id)).toBe(
    false,
  );
});
test("every Help audience can read the complete role comparison without receiving privileged how-to topics", () => {
  for (const role of [undefined, ...roles])
    expect(
      visibleHelpArticles(role).find((a) => a.id === "roles-overview")
        ?.roleComparison,
    ).toBe(true);
  expect(
    roleCapabilities.every((row) => roles.every((role) => !!row[role])),
  ).toBe(true);
  expect(
    visibleHelpArticles("staff").some(
      (a) => a.access === "admin" || a.access === "super_admin",
    ),
  ).toBe(false);
  expect(
    visibleHelpArticles("admin").some((a) => a.id === "grant-super-admin"),
  ).toBe(false);
  expect(
    visibleHelpArticles("super_admin").some(
      (a) => a.id === "grant-super-admin",
    ),
  ).toBe(true);
  expect(
    visibleHelpArticles("super_admin").some((a) => a.id === "expenses"),
  ).toBe(true);
});

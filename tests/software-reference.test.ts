import { beforeEach, describe, expect, test, vi } from "vitest";
import { referenceSchemas } from "@/lib/software-reference";
const context = vi.hoisted(() => ({
  role: "staff",
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAccess: vi.fn(async () => ({
    profile: { role: context.role },
    db: { from: context.from, rpc: context.rpc },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  createSoftwareReference,
  assignSoftwareEmployee,
} from "@/app/(hub)/software/reference-actions";
beforeEach(() => {
  context.role = "staff";
  context.from.mockReset();
  context.rpc.mockReset();
});
describe("software reference validation and action authorization", () => {
  test("accepts bounded names and rejects empty, overlong category or department names", () => {
    expect(
      referenceSchemas.category.parse({ name: "  Accessibility  " }),
    ).toEqual({ name: "Accessibility" });
    for (const name of ["", "   ", "x".repeat(81)])
      expect(referenceSchemas.category.safeParse({ name }).success).toBe(false);
    expect(
      referenceSchemas.department.safeParse({ name: "x".repeat(101) }).success,
    ).toBe(false);
  });
  test("payment references accept no card digits or exactly the last four, never full cards or security fields", () => {
    const value = {
      team_id: "10000000-0000-4000-8000-000000000001",
      nickname: "Purchasing",
      brand: "Visa",
      last_four: "1234",
      notes: "",
    };
    expect(referenceSchemas.payment.safeParse(value).success).toBe(true);
    expect(
      referenceSchemas.payment.safeParse({ ...value, last_four: "" }).success,
    ).toBe(true);
    for (const last_four of ["123", "12345", "4111111111111111", "abcd"])
      expect(
        referenceSchemas.payment.safeParse({ ...value, last_four }).success,
      ).toBe(false);
    expect(
      referenceSchemas.payment.parse({
        ...value,
        cvv: "123",
        password: "not-stored",
      }),
    ).toEqual(value);
  });
  test("Staff cannot create global references by calling the action directly", async () => {
    for (const kind of ["vendor", "category", "department", "payment"] as const)
      expect(
        await createSoftwareReference(kind, {
          name: "Escalation",
          role: "super_admin",
        }),
      ).toHaveProperty("error");
    expect(context.from).not.toHaveBeenCalled();
    expect(context.rpc).not.toHaveBeenCalled();
  });
  test("Finance cannot create departments or assign employees", async () => {
    context.role = "finance";
    expect(
      await createSoftwareReference("department", { name: "Unauthorized" }),
    ).toHaveProperty("error");
    expect(
      await assignSoftwareEmployee({
        team_id: "10000000-0000-4000-8000-000000000001",
        profile_id: "90000000-0000-4000-8000-000000000003",
      }),
    ).toHaveProperty("error");
    expect(context.from).not.toHaveBeenCalled();
    expect(context.rpc).not.toHaveBeenCalled();
  });
  test("invalid admin data is rejected before a database operation", async () => {
    context.role = "admin";
    expect(
      await createSoftwareReference("category", { name: " " }),
    ).toHaveProperty("error");
    expect(
      await assignSoftwareEmployee({
        team_id: "invalid",
        profile_id: "invalid",
      }),
    ).toHaveProperty("error");
    expect(context.from).not.toHaveBeenCalled();
    expect(context.rpc).not.toHaveBeenCalled();
  });
  test("employee assignment cannot smuggle Manage permission or an account role through the action", async () => {
    context.role = "admin";
    const team_id = "10000000-0000-4000-8000-000000000001",
      profile_id = "90000000-0000-4000-8000-000000000003";
    context.rpc.mockReturnValue({
      single: async () => ({
        data: {
          id: profile_id,
          full_name: "Verified employee",
          email: "employee@caedm.ca",
          can_manage: false,
        },
        error: null,
      }),
    });
    const result = await assignSoftwareEmployee({
      team_id,
      profile_id,
      can_manage: true,
      role: "super_admin",
      status: "active",
    });
    expect(context.rpc).toHaveBeenCalledWith("assign_software_employee", {
      department: team_id,
      employee: profile_id,
    });
    expect(result.can_manage).toBe(false);
  });
});

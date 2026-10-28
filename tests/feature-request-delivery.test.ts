import { beforeEach, afterEach, test, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/env", () => ({
  publicConfig: () => ({ url: "http://127.0.0.1:54321" }),
}));
vi.mock("@/lib/email", () => ({ emailProvider: () => ({ send: mocks.send }) }));
import {
  deliverFeatureRequest,
  runFeatureRequestEmails,
} from "@/lib/feature-requests";
import { POST } from "@/app/api/jobs/feature-requests/route";
import type { NextRequest } from "next/server";
const id = "a0000000-0000-4000-8000-000000000001";
const employee = "90000000-0000-4000-8000-000000000003";
const claimed = {
  status: "claimed",
  claim: "private-delivery-claim",
  request: {
    id,
    title: "Improve renewal reporting",
    area: "Upcoming Renewals",
    priority: "Normal",
    department: "",
    problem: "Our team needs an easier way to share renewal decisions.",
    solution: "Add a department export showing decision dates and owners.",
    benefit: "This will reduce manual follow-up work.",
    workaround: "",
    requester_name: "Employee",
    requester_email: "employee@caedm.ca",
    created_at: "2026-10-28T18:00:00Z",
  },
};
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-delivery-key");
  mocks.rpc.mockReset();
  mocks.send.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
test("delivers through the fixed developer recipient and records the matching lease", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: claimed, error: null })
    .mockResolvedValueOnce({ error: null });
  mocks.send.mockResolvedValue(undefined);
  expect((await deliverFeatureRequest(id, employee)).status).toBe("sent");
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "ruban.peppin@caedm.ca",
      replyTo: "employee@caedm.ca",
    }),
  );
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_feature_request_delivery",
    { request_id: id, claim: claimed.claim, successful: true },
  );
});
test("SMTP failures retain a saved request, record failure and do not expose provider details", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: claimed, error: null })
    .mockResolvedValueOnce({ error: null });
  mocks.send.mockRejectedValue(
    new Error("private SMTP diagnostic and credentials must not appear"),
  );
  const result = await deliverFeatureRequest(id, employee);
  expect(result.status).toBe("failed");
  expect(result.message).toContain("request is saved");
  expect(result.message).not.toContain("private SMTP");
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "finish_feature_request_delivery",
    { request_id: id, claim: claimed.claim, successful: false },
  );
});
test("sent or in-flight requests are not emailed again", async () => {
  for (const status of ["sent", "sending", "failed"]) {
    mocks.rpc.mockResolvedValueOnce({ data: { status }, error: null });
    expect((await deliverFeatureRequest(id, employee)).status).toBe(status);
  }
  expect(mocks.send).not.toHaveBeenCalled();
});
test("missing configuration and unclaimed requests fail closed without sending", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  expect((await deliverFeatureRequest(id, employee)).status).toBe("failed");
  expect(mocks.rpc).not.toHaveBeenCalled();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-delivery-key");
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
  expect((await deliverFeatureRequest(id, employee)).status).toBe("failed");
  expect(mocks.send).not.toHaveBeenCalled();
});
test("an uncertain database acknowledgement does not falsely promise delivery or send again", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: claimed, error: null })
    .mockResolvedValueOnce({ error: { message: "temporarily unavailable" } });
  mocks.send.mockResolvedValue(undefined);
  const result = await deliverFeatureRequest(id, employee);
  expect(result.status).toBe("sending");
  expect(result.message).toContain("status could not be confirmed");
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
test("the protected job drains only the database-selected delivery batch", async () => {
  mocks.rpc
    .mockResolvedValueOnce({
      data: [{ id, requester_id: employee }],
      error: null,
    })
    .mockResolvedValueOnce({ data: claimed, error: null })
    .mockResolvedValueOnce({ error: null });
  expect(await runFeatureRequestEmails()).toEqual({
    sent: 1,
    failed: 0,
    sending: 0,
  });
  expect(mocks.rpc).toHaveBeenNthCalledWith(
    1,
    "pending_feature_request_deliveries",
  );
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
test("missing, short and incorrect scheduler credentials never run the privileged job", async () => {
  for (const secret of [
    "",
    "short",
    "a-local-test-scheduler-secret-of-at-least-32-characters",
  ]) {
    vi.stubEnv("CRON_SECRET", secret);
    const response = await POST(
      new Request("http://localhost/api/jobs/feature-requests", {
        method: "POST",
        headers: { authorization: "Bearer incorrect" },
      }) as NextRequest,
    );
    expect(response.status).toBe(401);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
test("an authorized scheduler can run an empty queue without exposing any request data", async () => {
  const secret = "a-local-test-scheduler-secret-of-at-least-32-characters";
  vi.stubEnv("CRON_SECRET", secret);
  mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
  const response = await POST(
    new Request("http://localhost/api/jobs/feature-requests", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }) as NextRequest,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ sent: 0, failed: 0, sending: 0 });
});
test("job errors return a safe failure instead of database diagnostics", async () => {
  const secret = "a-local-test-scheduler-secret-of-at-least-32-characters";
  vi.stubEnv("CRON_SECRET", secret);
  mocks.rpc.mockRejectedValueOnce(new Error("private database diagnostics"));
  const response = await POST(
    new Request("http://localhost/api/jobs/feature-requests", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }) as NextRequest,
  );
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private database",
  );
});

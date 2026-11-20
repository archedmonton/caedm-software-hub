import { test, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/release-info", () => ({
  applicationVersion: "1.0.1",
  currentRelease: { status: "prepared", releaseDate: null },
  buildInformation: () => ({
    environment: "Production",
    commit: "a".repeat(40),
  }),
}));
import AboutContent from "@/components/hub/about-content";
test("ordinary About markup contains neither Git controls nor the commit value", async () => {
  const html = renderToStaticMarkup(
    await AboutContent({ showTechnical: false }),
  );
  expect(html).not.toContain("a".repeat(40));
  expect(html).not.toContain("Copy full commit");
  expect(html).not.toContain("Build commit");
});
test("authorized Developer About markup includes Git details", async () => {
  const html = renderToStaticMarkup(
    await AboutContent({ showTechnical: true }),
  );
  expect(html).toContain("Build commit");
  expect(html).toContain("a".repeat(40));
});

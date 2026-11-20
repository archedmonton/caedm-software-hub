import { test, expect } from "vitest";
import { releases } from "@/src/lib/releases";
import { validateReleases } from "@/src/lib/release-validation";
import metadata from "@/package.json";
test("package version, current release and navigation source share one validated version", () => {
  expect(releases[0].version).toBe(metadata.version);
  expect(validateReleases(metadata.version, releases)).toEqual([]);
});
test("a package/history mismatch and invalid semantic version fail validation", () => {
  expect(validateReleases("9.0.0", releases).length).toBeGreaterThan(0);
  expect(validateReleases("latest", releases).length).toBeGreaterThan(0);
});
test("duplicate and incorrectly ordered releases fail validation", () => {
  expect(
    validateReleases(metadata.version, [...releases, releases[0]]).length,
  ).toBeGreaterThan(0);
  expect(
    validateReleases(metadata.version, [
      releases[0],
      {
        ...releases[0],
        version: "2.0.0",
        status: "released",
        releaseDate: "2026-01-01",
      },
    ]).length,
  ).toBeGreaterThan(0);
});
test("invalid release dates and missing metadata fail validation", () => {
  expect(
    validateReleases(metadata.version, [
      { ...releases[0], releaseDate: "2026-02-30" },
    ]).length,
  ).toBeGreaterThan(0);
  expect(
    validateReleases(metadata.version, [{ ...releases[0], title: "" }]).length,
  ).toBeGreaterThan(0);
});
test("prepared releases omit dates and published releases require a valid date", () => {
  const prepared = {
    ...releases[0],
    status: "prepared" as const,
    releaseDate: null,
  };
  expect(validateReleases(metadata.version, [prepared])).toEqual([]);
  expect(
    validateReleases(metadata.version, [{ ...prepared, status: "released" }])
      .length,
  ).toBeGreaterThan(0);
});

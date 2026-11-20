import type { Release } from "./releases";
const semantic = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function validateReleases(version: string, history: readonly Release[]) {
  const errors: string[] = [];
  if (!semantic.test(version))
    errors.push("package.json must contain a valid semantic release version.");
  if (!history.length || history[0].version !== version)
    errors.push("The latest release entry must match package.json.");
  const seen = new Set<string>();
  history.forEach((release, index) => {
    if (!semantic.test(release.version))
      errors.push("Invalid release version.");
    if (seen.has(release.version))
      errors.push("Release versions must be unique.");
    seen.add(release.version);
    if (!release.title.trim() || !release.summary.trim())
      errors.push("Release title and summary are required.");
    for (const field of [
      "features",
      "improvements",
      "fixes",
      "security",
      "breakingChanges",
    ] as const)
      if (
        !Array.isArray(release[field]) ||
        release[field].some((item) => !item.trim())
      )
        errors.push(`Invalid ${field} metadata.`);
    if (!["prepared", "released"].includes(release.status))
      errors.push("Invalid release status.");
    if (release.releaseDate === null) {
      if (release.status !== "prepared" || index !== 0)
        errors.push(
          "Only the latest prepared release may have no release date.",
        );
    } else if (
      !/^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate) ||
      !Number.isFinite(Date.parse(release.releaseDate)) ||
      new Date(release.releaseDate).toISOString().slice(0, 10) !==
        release.releaseDate
    )
      errors.push("Invalid release date.");
    if (index) {
      const previous = history[index - 1];
      const a = previous.version.split(".").map(Number),
        b = release.version.split(".").map(Number);
      const comparison = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      if (comparison <= 0) errors.push("Release history must be newest first.");
      if (
        previous.releaseDate &&
        release.releaseDate &&
        previous.releaseDate < release.releaseDate
      )
        errors.push("Release dates must be newest first.");
    }
  });
  return errors;
}

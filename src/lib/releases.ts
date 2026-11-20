export type Release = {
  version: string;
  releaseDate: string | null;
  status: "prepared" | "released";
  title: string;
  summary: string;
  features: readonly string[];
  improvements: readonly string[];
  fixes: readonly string[];
  security: readonly string[];
  breakingChanges: readonly string[];
};

// No earlier semantic versions or publication dates are evidenced by Git tags.
// Assign a real release date only when preparing an approved production release.
export const releases: readonly Release[] = [
  {
    version: "1.0.0",
    releaseDate: "2026-11-20",
    status: "released",
    title: "A clearer workspace, with governed developer tools",
    summary:
      "The first formal version baseline for Software Hub. Earlier development is documented in repository history without invented release numbers.",
    features: [
      "About and release history with build information",
      "Separately authorized Developer Tools and restricted role previews",
      "Personalized announcements, email activity and developer access handover",
      "Purpose-specific CAEDM emails through Resend",
      "Audited administrator-assisted recovery with one-time private links",
    ],
    improvements: [
      "Dashboard prioritizes decisions and upcoming payments",
      "Settings separates personal notifications from administration",
      "Software editing supports inline reference creation and contextual Help",
      "Resend-first email delivery with bounded SMTP fallback after explicit rejection",
    ],
    fixes: [
      "Duplicate reference names receive clear validation",
      "Invitation email buttons retain readable hover colours and consistent spacing",
    ],
    security: [
      "Developer permissions remain independent of organization roles",
      "Role previews restrict server and database access without impersonation",
      "Developer access changes require fresh authentication and retain an audit trail",
      "Updated the application framework to the patched Next.js 16.4.5 release",
      "Recovery requires fresh authentication, restricts workspace access until a password change and blocks previous sessions",
    ],
    breakingChanges: [
      "This version requires the reviewed database migrations, signed Supabase email hook, Resend configuration and protected delivery schedules.",
    ],
  },
];

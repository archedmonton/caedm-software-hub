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
    version: "1.0.1",
    releaseDate: null,
    status: "prepared",
    title: "Reliable password reset emails and clearer recovery",
    summary:
      "Password reset emails support Supabase browser recovery tokens, and authorized support staff can email a reset directly to an employee.",
    features: [
      "Developer and Super Admin reset emails sent directly to the employee",
    ],
    improvements: [
      "One password reset page for email and assisted recovery",
      "Clear delivery acceptance and failure messages with recovery audit history",
    ],
    fixes: [
      "Accept Supabase PKCE-prefixed email tokens",
      "Keep emailed reset links unused until a password is submitted",
      "Provide a working /reset-password landing page",
    ],
    security: [
      "Git build details are visible only to authorized Developers",
      "Reset capabilities are no longer returned to the support operator's browser",
      "Fresh authentication, MFA and PostgreSQL recovery restrictions remain enforced",
    ],
    breakingChanges: [
      "Apply the recovery email audit migration before deploying this version. Previously issued valid assisted links remain supported.",
    ],
  },
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

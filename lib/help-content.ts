import type { Profile } from "@/lib/domain";
import { developer } from "@/lib/developer";
export type HelpCategory =
  | "Getting started"
  | "Software"
  | "Renewals & reviews"
  | "Finance"
  | "Administration";
export type HelpArticle = {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  steps: string[];
  access?: "workspace" | "finance" | "admin";
};
export const helpArticles: HelpArticle[] = [
  {
    id: "sign-in",
    category: "Getting started",
    title: "How do I sign in?",
    summary:
      "Use your own @caedm.ca work email and the password you created for Software Hub.",
    steps: [
      "Enter your work email and password on the sign-in page. Your Software Hub password may be different from your email account password.",
      "If you received an invitation, accept the latest invitation email and set your password before signing in.",
      "If your account is awaiting approval, your workspace administrator must assign your access. Repeated unsuccessful sign-in attempts can temporarily limit access; wait before retrying.",
    ],
  },
  {
    id: "invitation",
    category: "Getting started",
    title: "How do I accept an invitation?",
    summary:
      "Your administrator chooses your role and department. You choose your password.",
    steps: [
      "Open the latest email titled Invitation from CAEDM Software Hub and select Accept invitation.",
      "Create and confirm a password with at least 12 characters, uppercase and lowercase letters, and a number. Then sign in using your work email.",
      "Links expire after 72 hours. Resending replaces older links; accepted or revoked links cannot be reused. Ask your administrator for a new invitation if needed.",
      "Keep your invitation link private. Refreshing the password page may require reopening the original email link.",
    ],
  },
  {
    id: "request-access",
    category: "Getting started",
    title: "How do I request access without an invitation?",
    summary:
      "Self-registration requires both email verification and administrator approval.",
    steps: [
      "Select Request access on the sign-in page and register with your exact @caedm.ca email.",
      "Open the confirmation email and verify your email address.",
      "Your account stays pending until a workspace administrator approves it and assigns the appropriate role and department. If you already have an invitation, complete that invitation instead of registering again.",
    ],
  },
  {
    id: "pending",
    category: "Getting started",
    title: "Why does it say my request is with IT?",
    summary:
      "Your account is waiting for a workspace administrator to approve access.",
    steps: [
      "Verify your work email first. A verified email alone does not activate a self-registered account.",
      "Contact your CAEDM workspace administrator and give them your work email. They will review your role, status and department.",
      "After approval, select Check access or sign out and sign in again. A suspended or deactivated account also requires administrator assistance.",
    ],
  },
  {
    id: "password",
    category: "Getting started",
    title: "How do I reset a forgotten password?",
    summary:
      "Use Forgot password on the sign-in page to request a secure reset link.",
    steps: [
      "Enter the work email you registered with. The confirmation message does not reveal whether an account exists.",
      "Check your inbox and junk folder. Open the latest reset email and choose a new password.",
      "If the message does not arrive or the link has expired, contact your administrator. Resetting a password does not approve a pending or restricted account.",
    ],
  },
  {
    id: "missing-email",
    category: "Getting started",
    title: "Why have I not received an email?",
    summary:
      "Invitations, verification and password resets require working email delivery.",
    steps: [
      "Confirm the work email address is correct and check your junk folder or organizational quarantine.",
      "Use the latest message; previous invitation links stop working after a resend.",
      "Ask your workspace administrator to check invitation delivery status or the email service. A message saying a reset was requested does not guarantee inbox delivery.",
      "Never send your password or invitation link to someone helping you.",
    ],
  },
  {
    id: "dashboard",
    category: "Getting started",
    access: "workspace",
    title: "What do the dashboard numbers mean?",
    summary:
      "The dashboard summarizes the software and departments your role can access.",
    steps: [
      "Monthly and annual equivalents estimate recurring spending; they are not recorded invoices or expenses.",
      "Each currency is reported separately. The application does not convert currencies.",
      "Watch decision deadlines and license expiry alongside renewal dates. A cancellation notice deadline can occur before the next payment.",
      "Use the chart currency selector and View spending data for a tabular alternative. Dates and times use America/Edmonton where shown.",
    ],
  },
  {
    id: "software",
    category: "Software",
    access: "workspace",
    title: "How do I add or edit software?",
    summary:
      "Software Inventory is the home for subscription details, ownership and billing.",
    steps: [
      "Search or filter Software Inventory before creating a record to avoid duplicates.",
      "Select Add software, complete the required fields, and choose the responsible department and owner.",
      "Enter the billing amount, currency, cycle, start date and cancellation notice period carefully. Use a one-time purchase for a non-recurring item.",
      "Open an existing record and choose Edit to update its details. Staff need permission to manage that department's software; Finance and Administrators have wider access.",
    ],
  },
  {
    id: "permissions",
    category: "Software",
    access: "workspace",
    title: "Why can I see a record but not change it?",
    summary:
      "Viewing, managing, and owning software are separate responsibilities.",
    steps: [
      "Staff can view software in their assigned departments. A view-only membership does not allow edits.",
      "A department membership with manage permission allows software changes within that department. Being an owner does not itself grant management permission.",
      "The assigned owner responds to usage reviews. Ask your administrator to correct department access or ownership if needed.",
      "Finance and Administrator roles can access organization-wide records. Missing navigation items may reflect your role.",
    ],
  },
  {
    id: "licenses",
    category: "Software",
    access: "workspace",
    title: "How do I track licenses and ownership?",
    summary: "Keep the person responsible and the seats in use current.",
    steps: [
      "On the software edit form, select the owner and record licenses purchased, licenses used and any license notes.",
      "Record a license expiry date when it differs from the payment or renewal date.",
      "Transfer ownership from the software edit form when responsibilities change. Outstanding reviews follow the new owner.",
    ],
  },
  {
    id: "cancellation",
    category: "Software",
    access: "workspace",
    title: "What is the difference between pausing, cancelling and archiving?",
    summary:
      "These actions update internal records and preserve financial history.",
    steps: [
      "Pause billing when payments are temporarily on hold; paused records do not produce recurring payment projections.",
      "Mark cancelled when the subscription has been cancelled. Complete the actual cancellation with the vendor separately.",
      "Archive a record when it should leave active tracking. Historical records and recorded expenses remain available.",
      "Check the confirmation dialog before changing status. Updating Software Hub does not cancel a vendor contract or stop a vendor payment.",
    ],
  },
  {
    id: "renewals",
    category: "Renewals & reviews",
    access: "workspace",
    title: "How do I read upcoming renewals and decision deadlines?",
    summary: "Plan decisions before the cancellation notice period ends.",
    steps: [
      "Open Upcoming Renewals and choose the planning window. Check both the projected payment date and the earlier decision deadline.",
      "Recurring projections use the billing anchor. An explicit next billing date takes priority; custom cycles use whole months.",
      "With auto-renew disabled or cancellation pending, only the recorded next charge is projected. Paused, cancelled, expired, archived and one-time records have no recurring projections.",
      "Projection amounts are estimates. Finance records actual transactions separately.",
    ],
  },
  {
    id: "reviews",
    category: "Renewals & reviews",
    access: "workspace",
    title: "How do I respond to a usage review?",
    summary:
      "The software owner tells Finance whether a subscription is still needed.",
    steps: [
      "Open Usage Reviews and select an outstanding review assigned to you.",
      "Choose Still Needed, Not Needed or Unsure and add a comment that explains the decision.",
      "Review your answer before submitting: a response is recorded once with a timestamp.",
      "Finance receives a queued notification. A Not Needed response does not automatically cancel the vendor subscription. Contact your administrator if a submitted answer needs clarification.",
    ],
  },
  {
    id: "expenses",
    category: "Finance",
    access: "finance",
    title: "How do I record and correct an expense?",
    summary: "Record confirmed spending separately from payment forecasts.",
    steps: [
      "Open Finance Centre and record the actual transaction against its software record, including date, amount, tax, currency and references.",
      "Enter tax explicitly; projected amounts do not calculate or invent tax.",
      "Use the expense correction form to correct a mistake. The application retains audit history rather than silently discarding the original information.",
      "Department, vendor and payment references are snapshotted with an expense so later organizational edits do not rewrite financial history.",
    ],
  },
  {
    id: "exports",
    category: "Finance",
    access: "finance",
    title: "How do I export reports and compare totals?",
    summary:
      "Finance and Administrators can download filtered CSV and Excel reports.",
    steps: [
      "Choose the Software Register or Expense Report and set the desired department, vendor, payment reference and date filters.",
      "The Software Register uses purchase dates; Expense Reports use transaction dates.",
      "Download CSV or Excel. Totals stay separate by currency; do not add CAD and USD together as one amount.",
      "Recorded expenses show confirmed spending. Recurring equivalents and projected payments are planning estimates.",
    ],
  },
  {
    id: "invite-admin",
    category: "Administration",
    access: "admin",
    title: "How do I invite an employee and assign their department?",
    summary: "Use Team Management to onboard a new employee in one flow.",
    steps: [
      "Create a department if needed, then complete Invite an employee with their name and exact work email.",
      "Choose Staff, Finance or Administrator and the department's view or manage permission. Staff are department-limited; Finance and Administrators have organization-wide access.",
      "Send the invitation and check its delivery status. The employee must accept the email and set a password before access becomes active.",
      "Invitations are for new accounts. For an existing account, use Registered accounts and Assign department access instead.",
    ],
  },
  {
    id: "manage-invites",
    category: "Administration",
    access: "admin",
    title: "How do I resend or revoke an invitation?",
    summary: "Manage invitation status under Team Management.",
    steps: [
      "Find the employee in Employee invitations and check whether the invitation is pending, expired, accepted, revoked or failed delivery.",
      "Resend after at least one minute to issue a fresh 72-hour link. Previous links become invalid. Each administrator can prepare up to 20 invitations per hour.",
      "Revoke an unused invitation to prevent its link from activating the account.",
      "For accepted invitations, manage the person's account status instead. For delivery failures, have the mail service corrected before resending.",
    ],
  },
  {
    id: "approval",
    category: "Administration",
    access: "admin",
    title: "How do I approve or restrict an existing account?",
    summary: "Manage verified registered accounts in Team Management.",
    steps: [
      "Find the employee under Registered accounts. Confirm that their email has been verified before approval.",
      "Select the appropriate role and account status, then Update access. Assign their department separately when using self-registration.",
      "Use suspended or deactivated status to restrict access when required. Keep at least one verified active administrator.",
      "An account with an unfinished invitation must complete its password setup before activation.",
    ],
  },
  {
    id: "teams",
    category: "Administration",
    access: "admin",
    title: "How do departments and software permissions work?",
    summary: "Department membership controls Staff access to software.",
    steps: [
      "Create the department, then choose the employee and department under Assign department access.",
      "Choose View department software for read-only access, or View and manage for software changes.",
      "People can belong to more than one department. Remove only the memberships they no longer need.",
      "Finance and Administrators have organization-wide access regardless of their assigned department. Assign software owners from each software record's edit form.",
    ],
  },
  {
    id: "settings",
    category: "Administration",
    access: "admin",
    title: "How do I manage reminders and shared references?",
    summary:
      "Settings contains organization preferences, reminder rules and shared reference data.",
    steps: [
      "Review organization settings, reporting currencies, initial review notice and follow-up notice. The organization timezone is America/Edmonton.",
      "Run reminders now creates due reviews and attempts queued notifications. Check notification activity for delivery failures.",
      "Keep vendors and payment references current. Store only limited card references, such as the last four digits; never enter full card numbers, CVVs or vendor passwords.",
      "Email delivery and scheduled reminder operation require administrator setup. Contact the person responsible for hosting or email if failures continue.",
    ],
  },
  {
    id: "account",
    category: "Getting started",
    access: "workspace",
    title: "Where do I find my account details or sign out?",
    summary:
      "Settings shows your profile, role, account status and organization timezone.",
    steps: [
      "Open Settings to check your current access information.",
      "Use the account menu in the top bar, or the sign-out icon beside your name in the sidebar, to sign out.",
      "Ask your workspace administrator to update your role or department. Use Forgot password on the sign-in screen if you need to reset your password.",
    ],
  },
  {
    id: "support",
    category: "Getting started",
    title: "What should I send when asking for help?",
    summary: `Contact ${developer.name}, ${developer.title}, at ${developer.email} with enough detail to reproduce the issue.`,
    steps: [
      "Include the page name, the action you were trying to complete, the time, and the exact error message.",
      "For missing records, mention the expected department and software name. Your role and department may limit what you can see.",
      "Share a screenshot only after hiding financial or personal details that are not needed.",
      "Never share passwords, invitation links or other access credentials.",
    ],
  },
  {
    id: "feature-request",
    category: "Getting started",
    title: "How do I request a feature or contact the developer?",
    summary: `For a hand with Software Hub, contact ${developer.name} at ${developer.email}.`,
    steps: [
      "Choose Request a Feature in Help to open the professional request form. Sign in with a verified CAEDM account; active employees and employees awaiting approval are eligible.",
      "Give the request a clear title and explain the problem, proposed improvement, expected benefit and priority. Your verified name and email are included automatically.",
      "Your request is saved and queued for a background email to Ruban for review. Refresh Your recent requests to check delivery. Failed emails retry automatically; you can also queue a retry after at least one minute. You can submit up to five requests per hour, with up to five email attempts per request.",
      "Keep your request reference for follow-up. Please do not include passwords, invitation links or confidential financial information.",
    ],
  },
  {
    id: "references",
    category: "Finance",
    access: "finance",
    title: "How do I manage vendors and payment references?",
    summary: "Shared references keep software and expense records consistent.",
    steps: [
      "Open Settings to add vendors and department payment references before assigning them on software records.",
      "Use a recognizable nickname and the appropriate department. Record only permitted details such as card brand and last four digits; never store a full card number, CVV or vendor password.",
      "Choose these references on the software form. Recorded expenses keep a snapshot of their references so later edits do not rewrite financial history.",
    ],
  },
];
export function visibleHelpArticles(role?: Profile["role"]) {
  return helpArticles.filter(
    (a) =>
      !a.access ||
      (a.access === "workspace" && !!role) ||
      (a.access === "finance" && (role === "finance" || role === "admin")) ||
      (a.access === "admin" && role === "admin"),
  );
}
export function helpContext(path: string) {
  if (path.startsWith("/request-feature"))
    return { id: "feature-request", page: "requesting a feature" };
  if (path.startsWith("/accept-invitation"))
    return { id: "invitation", page: "accepting your invitation" };
  if (path.startsWith("/pending-approval"))
    return { id: "pending", page: "account approval" };
  if (path.includes("forgot-password") || path.includes("update-password"))
    return { id: "password", page: "password recovery" };
  if (path === "/register" || path.includes("sign-up"))
    return { id: "request-access", page: "requesting access" };
  if (path.startsWith("/software"))
    return { id: "software", page: "Software Inventory" };
  if (path.startsWith("/renewals"))
    return { id: "renewals", page: "Upcoming Renewals" };
  if (path.startsWith("/reviews"))
    return { id: "reviews", page: "Usage Reviews" };
  if (path.startsWith("/finance"))
    return { id: "expenses", page: "Finance Centre" };
  if (path.startsWith("/team"))
    return { id: "invite-admin", page: "Team Management" };
  if (path.startsWith("/settings")) return { id: "account", page: "Settings" };
  if (path.startsWith("/dashboard"))
    return { id: "dashboard", page: "your dashboard" };
  return { id: "sign-in", page: "signing in" };
}

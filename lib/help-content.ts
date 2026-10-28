import { adminRole, financeRole, type Profile } from "@/lib/domain";
import { developer } from "@/lib/developer";
export type HelpCategory =
  | "Getting started"
  | "Roles & access"
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
  access?: "workspace" | "finance" | "admin" | "super_admin";
  roleComparison?: boolean;
};
export const roleCapabilities = [
  {
    capability: "View software, costs and renewals",
    super_admin: "All departments",
    admin: "All departments",
    finance: "All departments",
    staff: "Assigned departments",
  },
  {
    capability: "Add, edit, pause, cancel or archive software",
    super_admin: "All departments",
    admin: "All departments",
    finance: "All departments",
    staff: "Manage permission required",
  },
  {
    capability: "Record/correct expenses and export reports",
    super_admin: "Yes",
    admin: "Yes",
    finance: "Yes",
    staff: "No",
  },
  {
    capability: "Manage vendors and payment references",
    super_admin: "Yes",
    admin: "Yes",
    finance: "Yes",
    staff: "No",
  },
  {
    capability: "Invite and approve ordinary employees",
    super_admin: "Yes",
    admin: "Yes",
    finance: "No",
    staff: "No",
  },
  {
    capability: "Create departments and assign access",
    super_admin: "Yes",
    admin: "Ordinary accounts",
    finance: "No",
    staff: "No",
  },
  {
    capability: "Configure organization settings and run reminders",
    super_admin: "Yes",
    admin: "Yes",
    finance: "No",
    staff: "No",
  },
  {
    capability: "Grant/revoke Super Admin or manage those accounts",
    super_admin: "Yes, except protected developer",
    admin: "No",
    finance: "No",
    staff: "No",
  },
  {
    capability: "Respond to a usage review",
    super_admin: "Assigned owner only",
    admin: "Assigned owner only",
    finance: "Assigned owner only",
    staff: "Assigned owner only",
  },
  {
    capability: "Request features and check own submissions",
    super_admin: "Yes",
    admin: "Yes",
    finance: "Yes",
    staff: "Yes",
  },
] as const;
export const helpArticles: HelpArticle[] = [
  {
    id: "roles-overview",
    category: "Roles & access",
    title:
      "What is the difference between Super Admin, Admin, Finance and Staff?",
    summary:
      "Your account role controls organization-wide capabilities. Department permissions control Staff access. Software ownership controls who answers usage reviews.",
    roleComparison: true,
    steps: [
      "Super Admin has all Admin and Finance capabilities and can grant, revoke or manage other Super Admin accounts. The protected developer account remains active and cannot be demoted, suspended or removed by another application administrator.",
      "Admin manages ordinary employees, roles, invitations, approvals, departments, organization settings and reminders. Admin also has organization-wide software and Finance access, but cannot grant Super Admin or change a Super Admin account or its department memberships.",
      "Finance has organization-wide software, renewal, expense, reporting, vendor and payment-reference access. Finance cannot invite or approve employees, change roles or department memberships, create departments, or configure organization reminder rules.",
      "Staff can see software, subscription prices and renewals only in assigned departments. View permission is read-only; Manage permission allows software changes in that department. Staff cannot access recorded expenses, Finance Centre, exports or employee administration.",
      "All workspace roles require a verified, active CAEDM account. Being invited, verifying an email, or choosing a role in registration metadata does not itself approve access. Pending accounts can use Help and submit feature requests after verification, but cannot enter the workspace.",
      "Admin, Finance and Super Admin access is organization-wide even without department memberships. Assigning a department does not narrow these roles' access. A department name entered in a feature request does not grant membership.",
      "Software ownership is separate: only the assigned owner can answer a usage review, and only once. Ownership does not grant software editing or expense access. Historical financial records remain preserved for every role.",
      "Open Settings to see your own role and status. Contact your Admin or Super Admin if the assigned role or department is incorrect. New access is checked again on subsequent requests; refresh or sign in again after an authorized change.",
    ],
  },
  {
    id: "staff-access",
    category: "Roles & access",
    title: "How do Staff View, Manage and software ownership differ?",
    summary:
      "Staff permissions are assigned separately for each department; a person can belong to multiple departments.",
    steps: [
      "View department software allows reading the assigned department's dashboard data, software details, subscription costs and renewal projections. It does not allow changing software.",
      "View and manage department software allows creating and editing department software, managing seats, billing and license details, transferring valid ownership, and pausing, cancelling or archiving records. It does not grant Finance or employee administration access.",
      "The responsible software owner receives usage reviews. An owner must also have access to that software's department to respond. A view-only member can answer their assigned review without gaining edit permission.",
      "An Admin or Super Admin assigns memberships through Team Management. Transfer active software ownership before removing department access. Removing an unrelated membership does not delete financial or software history.",
      "Recorded expenses and CSV/Excel exports are restricted to Finance, Admin and Super Admin, even when Staff can view the subscription's price. For broader access, request an appropriate role change rather than sharing another person's account.",
    ],
  },
  {
    id: "finance-access",
    category: "Roles & access",
    title: "What can Finance do, and what requires an Admin?",
    summary:
      "Finance coordinates organization-wide software stewardship and confirmed spending without controlling employee access.",
    steps: [
      "Review and manage software, owners, renewals, subscription costs and licenses across all departments. Department membership is not required and does not limit Finance visibility.",
      "Record and correct confirmed expenses, view financial and audit information, export Software Register and Expense Report CSV/Excel files, and maintain vendors and limited payment references.",
      "Keep confirmed transactions separate from projected payments. Currencies remain separate; no role can use the application to discard recorded financial history or automatically cancel a contract with a vendor.",
      "Finance can read usage reviews and receives response/escalation notifications, but can answer a review only when assigned as its owner. Requesting a new review manually and running reminders require Admin or Super Admin.",
      "Contact an Admin or Super Admin for employee invitations, approvals, department creation, memberships, role changes and organization settings. Contact a Super Admin for any Super Admin account change.",
    ],
  },
  {
    id: "admin-access",
    category: "Roles & access",
    title: "What can Admin manage, and what is protected?",
    summary:
      "Admin has Finance capabilities plus ordinary employee and organization administration.",
    steps: [
      "Invite new employees, resend or revoke unused invitations, approve verified registrations, and assign Admin, Finance or Staff roles and account status to ordinary accounts.",
      "Create departments, grant View or Manage department memberships, remove eligible memberships after ownership transfer, configure reporting currencies and reminder rules, and run reminders or request usage reviews.",
      "Admin cannot assign Super Admin, promote itself, downgrade or suspend a Super Admin, or add, change or remove a Super Admin's department memberships. Those accounts are read-only for Admins.",
      "The developer account for Ruban Peppin is protected. Other application administrators, including delegated Super Admins, cannot demote, suspend or remove its access. Protection is enforced by PostgreSQL as well as the screen controls.",
      "Assign the minimum access needed for the person's work. Use Staff plus Manage for a departmental software editor, Finance for organization-wide software and expenses, and Admin for ordinary employee administration.",
    ],
  },
  {
    id: "super-admin-access",
    category: "Roles & access",
    title: "What is Super Admin and how is the developer protected?",
    summary:
      "Super Admin adds control of other privileged accounts to all Admin and Finance capabilities.",
    steps: [
      "An active Super Admin can grant Super Admin access to an existing verified, active CAEDM employee and can revoke that role or restrict other non-protected Super Admin accounts.",
      "The existing developer identity ruban.peppin@caedm.ca is pinned to its database account when protected access is initialized. No automatic Super Admin privilege is granted during registration, from editable signup metadata, or just because an email matches the developer contact.",
      "The protected developer must remain active with Super Admin access. Another application administrator cannot change its account access or department memberships. Additional Super Admins do not inherit this permanent developer protection.",
      "New employees first accept a normal Admin, Finance or Staff invitation and set their own password. Super Admin is granted afterwards; invitation links never grant that role directly.",
      "The application retains at least one verified active Super Admin and at least one active administrative account. Role changes are audited. Super Admin still follows verification, review-owner rules and financial history retention.",
      "Application roles do not administer Vercel, Supabase project ownership, SMTP passwords or infrastructure. Recovery of a protected account is an authorized database-operator task, not an ordinary Team Management action.",
    ],
  },
  {
    id: "grant-super-admin",
    category: "Roles & access",
    access: "super_admin",
    title: "How do I grant or revoke Super Admin access?",
    summary:
      "Only a verified, active Super Admin can perform these changes for a non-protected account.",
    steps: [
      "Invite the employee normally or approve their verified registration first. If they have an invitation, they must complete password setup before activation.",
      "Open Team Management and find the person under Registered accounts. Confirm the work email, active status and intended responsibilities before granting privileged access.",
      "Select Super Admin in Role, keep Status active, choose Update access and confirm. The employee should refresh or sign in again to see the new controls. The change is recorded in audit history.",
      "To revoke elevated access, select Admin, Finance or Staff and confirm Update access. If choosing Staff, also assign the departments and View/Manage permissions they need. Use suspended or deactivated to restrict a non-protected account when necessary.",
      "You cannot downgrade, suspend or remove the protected developer account, and the last active Super Admin cannot be removed. Contact the developer or authorized database operator for recovery issues.",
    ],
  },
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
      "Finance, Admin and Super Admin roles can access organization-wide records. Missing navigation items may reflect your role. See Roles & access for the full comparison.",
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
      "Select the appropriate ordinary role and account status, then Update access. Assign their department separately when using self-registration. Only Super Admins can grant or manage Super Admin access after an account becomes active.",
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
      "Finance, Admin and Super Admin have organization-wide access regardless of assigned department. Admins cannot change Super Admin memberships, and only the protected developer can change its own memberships. Assign software owners from each software record's edit form.",
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
      (a.access === "finance" && !!role && financeRole(role)) ||
      (a.access === "admin" && !!role && adminRole(role)) ||
      (a.access === "super_admin" && role === "super_admin"),
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

export const emailSenders = {
  authentication: "noreply@caedm.ca",
  notifications: "notifications@caedm.ca",
  invitations: "invitations@caedm.ca",
  security: "security-alerts@caedm.ca",
  reports: "reports@caedm.ca",
  approvals: "approvals@caedm.ca",
} as const;
export type EmailPurpose = keyof typeof emailSenders;

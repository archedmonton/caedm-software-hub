export const reviewHelp = {
  overview: {
    title: "Usage reviews",
    text: "Usage reviews ask the assigned owner whether software is still needed before the cancellation decision deadline. Only that review's owner can answer, including when the owner is Finance or an administrator. Settings → Notifications controls software emails, including review requests and Finance updates. Turning emails off does not remove reviews or the responsibility to answer them in the Hub.",
  },
  filters: {
    title: "Review filters",
    text: "Awaiting response shows unanswered reviews, including overdue ones. Completed shows submitted responses; All reviews includes both. Staff see assigned reviews, while Finance and administrators have organization-wide visibility.",
  },
  amount: {
    title: "Renewal amount",
    text: "The software's expected amount for one billing cycle, in its original currency. This is a forecast, not a recorded expense. Different currencies are kept separate.",
  },
  deadline: {
    title: "Decision deadline",
    text: "The renewal date minus the vendor's cancellation notice period. Respond before this date so Finance can act in time. A deadline before today is overdue. Changing a record here does not cancel the vendor contract.",
  },
  response: {
    title: "Usage response",
    text: "Still Needed means the team relies on the software. Not Needed asks Finance to consider cancellation; it does not cancel anything automatically. Unsure asks for discussion. A response is recorded once with a timestamp; review it before submitting.",
  },
  attention: {
    title: "Finance attention",
    text: "Escalated means an unanswered review passed its decision deadline. Decision needed means the owner answered Not Needed or Unsure. Finance must review and follow up; these labels do not record a payment or cancel software.",
  },
  owner: {
    title: "Review owner",
    text: "The employee assigned to this review can submit the response. View or administrator access alone does not allow someone else to answer it. Contact an administrator if the review needs reassignment or follow-up.",
  },
  renewal: {
    title: "Review renewal date",
    text: "The renewal date captured when this review was requested. The decision deadline may be earlier because of cancellation notice. Check the current software record if billing details changed after the request.",
  },
  comment: {
    title: "Review comment",
    text: "Give Finance useful context: why the software is needed, what could replace it, or what needs discussion. Maximum 3,000 characters. Do not include passwords, full card details, confidential client data or access tokens.",
  },
} as const;

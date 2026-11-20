import type { AnnouncementTemplate } from "@/lib/announcement-content";
export type Announcement = {
  id: string;
  title: string;
  subject: string;
  body: string;
  template: AnnouncementTemplate;
  audience: string;
  selected_emails: string[];
  content_hash: string;
  test_accepted_hash: string | null;
  state: string;
  created_by: string;
  created_at: string;
  queued_at: string | null;
};
export type Audience = {
  audience: string;
  eligible: number;
  excluded: number;
  duplicates_removed: number;
  count: number;
  people: { email: string; full_name: string }[];
};
export type AnnouncementPreview = {
  announcement: Announcement;
  audience: Audience;
  html: string;
  sender: { email: string; full_name: string };
};
export type EmailActivity = {
  id: string;
  type: string;
  subject: string;
  email: string;
  status: string;
  attempts: number;
  created_at: string;
  safe_error: string | null;
  is_test: boolean;
  announcement_id: string | null;
};
export type AnnouncementHistory = Announcement & {
  total: number;
  queued: number;
  sending: number;
  accepted: number;
  delivered: number;
  failed: number;
  skipped: number;
};
export type DeveloperActivity = {
  announcements: AnnouncementHistory[];
  outbox: EmailActivity[];
};

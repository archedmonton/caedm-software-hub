import Link from "next/link";
import { randomUUID } from "node:crypto";
import { Lightbulb, ArrowLeft } from "lucide-react";
import { session } from "@/lib/auth";
import { developer } from "@/lib/developer";
import {
  eligibleFeatureRequester,
  type FeatureRequestReceipt,
} from "@/lib/feature-request-content";
import { Brand } from "@/components/hub/brand";
import { HelpCenter } from "@/components/hub/help-center";
import {
  FeatureRequestForm,
  RetryFeatureRequest,
} from "@/components/hub/feature-request-form";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Request a Feature" };
export default async function RequestFeaturePage() {
  const { db, profile, user } = await session();
  const eligible = eligibleFeatureRequester(profile, user);
  const back = profile.status === "active" ? "/dashboard" : "/pending-approval";
  const { data: requests, error } = eligible
    ? await db
        .from("feature_requests")
        .select(
          "id,title,delivery_status,delivery_error,created_at,email_sent_at,area,priority,delivery_attempts",
        )
        .eq("requester_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [], error: null };
  const ready = eligible && !error;
  return (
    <main className="feature-page">
      <div className="feature-page-header">
        <Brand href={back} />
        <HelpCenter
          role={profile.status === "active" ? profile.role : undefined}
        />
      </div>
      <div className="feature-page-body">
        <Link className="feature-back" href={back}>
          <ArrowLeft size={15} aria-hidden="true" />
          Back to {profile.status === "active" ? "workspace" : "account status"}
        </Link>
        <div className="feature-intro">
          <span className="icon-tile">
            <Lightbulb size={24} aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">HELP SHAPE SOFTWARE HUB</span>
            <h1>Request a Feature</h1>
            <p>
              Tell us what would make your work easier. Your suggestion goes
              directly to {developer.name} for review.
            </p>
          </div>
        </div>
        <div className="feature-layout">
          <section className="panel feature-form-panel">
            {ready ? (
              <FeatureRequestForm
                requestKey={randomUUID()}
                name={profile.full_name}
                email={profile.email}
              />
            ) : (
              <div className="notice" role="status">
                {!eligible
                  ? "Feature requests are available to verified CAEDM accounts that are active or awaiting approval. Verify your email or contact the developer for assistance."
                  : "Feature requests are temporarily unavailable. Contact the developer, or try again after setup is complete."}
              </div>
            )}
          </section>
          <aside className="panel feature-contact">
            <span className="eyebrow">DEVELOPER INFORMATION</span>
            <h2>{developer.name}</h2>
            <p>{developer.title}</p>
            <a href={`mailto:${developer.email}`}>{developer.email}</a>
            <h3>What happens next?</h3>
            <ol>
              <li>Your request is saved with a reference number.</li>
              <li>
                The next background delivery run sends a structured email to{" "}
                {developer.name}. Replies can go directly to your verified work
                email.
              </li>
              <li>
                If email delivery fails, your request remains saved and you can
                retry below. Refresh this page to see the latest delivery
                status.
              </li>
            </ol>
            <p className="field-hint">
              Verified employees awaiting account approval can also submit
              suggestions. This does not grant access to other workspace
              features.
            </p>
          </aside>
        </div>
        {eligible && !error && (
          <section
            className="panel feature-history"
            aria-labelledby="feature-history-heading"
          >
            <div className="panel-heading">
              <div>
                <h2 id="feature-history-heading">Your recent requests</h2>
                <p>
                  Your ten most recent submissions and their email delivery
                  status.
                </p>
              </div>
            </div>
            {!requests?.length ? (
              <p className="feature-history-empty">
                You have not submitted a feature request yet.
              </p>
            ) : (
              <div className="feature-history-list">
                {requests.map(
                  (
                    r: FeatureRequestReceipt & {
                      area: string;
                      priority: string;
                      delivery_error: string | null;
                      delivery_attempts: number;
                    },
                  ) => (
                    <article key={r.id}>
                      <div>
                        <h3>{r.title}</h3>
                        <p>
                          {r.area} / {r.priority} priority
                        </p>
                        <p className="feature-reference">Reference: {r.id}</p>
                        <time dateTime={r.created_at}>
                          {new Intl.DateTimeFormat("en-CA", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "America/Edmonton",
                          }).format(new Date(r.created_at))}{" "}
                          (Edmonton)
                        </time>
                      </div>
                      <div className="feature-delivery">
                        <span className={`status status-${r.delivery_status}`}>
                          {
                            {
                              pending: "Awaiting email",
                              sending: "Sending email",
                              sent: "Email sent",
                              failed: "Email needs attention",
                            }[r.delivery_status]
                          }
                        </span>
                        {r.delivery_error && <p>{r.delivery_error}</p>}
                        {r.delivery_status !== "sent" &&
                          r.delivery_attempts < 5 && (
                            <RetryFeatureRequest id={r.id} />
                          )}
                      </div>
                    </article>
                  ),
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

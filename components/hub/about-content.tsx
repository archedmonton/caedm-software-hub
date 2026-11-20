import {
  applicationVersion,
  buildInformation,
  currentRelease,
} from "@/lib/release-info";
import { releases } from "@/src/lib/releases";
import { PageHeading } from "@/components/hub/common";
import { CopyCommit } from "@/components/hub/copy-commit";
import { developer } from "@/lib/developer";
export default async function AboutPage() {
  const build = buildInformation();
  return (
    <div className="readable-workspace about-page">
      <PageHeading
        eyebrow="ABOUT YOUR WORKSPACE"
        title="CAEDM Software Hub"
        description="Clearer software commitments. Better stewardship at every renewal."
      />
      <div className="about-overview">
        <section className="card about-primary">
          <span className="eyebrow">SOFTWARE, PEOPLE & STEWARDSHIP</span>
          <h2>One shared picture of our software.</h2>
          <p>
            Track software, subscriptions, responsible employees, renewals and
            recorded expenses for the Catholic Archdiocese of Edmonton.
          </p>
          <div className="release-version">
            v{applicationVersion}{" "}
            <span className="status">
              {currentRelease.status === "prepared"
                ? "Prepared · not released"
                : "Released"}
            </span>
          </div>
          <p>
            {currentRelease.releaseDate
              ? `Release date: ${currentRelease.releaseDate}`
              : "Release date: Not assigned. This version is awaiting release approval."}
          </p>
        </section>
        <section className="card">
          <h2>Application information</h2>
          <dl className="about-details">
            <dt>Organization</dt>
            <dd>Catholic Archdiocese of Edmonton</dd>
            <dt>Environment</dt>
            <dd>{build.environment}</dd>
            <dt>Build commit</dt>
            <dd>
              {build.commit ? (
                <CopyCommit sha={build.commit} />
              ) : build.environment === "Local development" ? (
                "Development build · deployment metadata unavailable"
              ) : (
                "Deployment commit metadata unavailable"
              )}
            </dd>
            <dt>Developer contact</dt>
            <dd>
              {developer.email ? (
                <a href={`mailto:${developer.email}`}>
                  {developer.name} · {developer.email}
                </a>
              ) : (
                "Developer contact is not configured. Contact your workspace administrator."
              )}
            </dd>
          </dl>
        </section>
      </div>
      <section aria-labelledby="release-history">
        <h2 id="release-history">Release history</h2>
        <p className="section-intro">
          Prepared releases are shown explicitly. Earlier development has no
          recorded numbered release boundaries.
        </p>
        {releases.map((release) => (
          <article className="card release-card" key={release.version}>
            <div className="release-card-heading">
              <span className="version-pill">v{release.version}</span>
              <span>{release.releaseDate || "Unreleased"}</span>
            </div>
            <h3>{release.title}</h3>
            <p>{release.summary}</p>
            {(
              [
                ["Features", release.features],
                ["Improvements", release.improvements],
                ["Fixes", release.fixes],
                ["Security", release.security],
                ["Release notes", release.breakingChanges],
              ] as const
            ).map(([title, items]) =>
              items.length ? (
                <div key={title}>
                  <h4>{title}</h4>
                  <ul>
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

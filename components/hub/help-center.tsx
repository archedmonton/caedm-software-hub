"use client";
import { useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CircleHelp, Search, X, ChevronDown, LifeBuoy } from "lucide-react";
import { helpContext, visibleHelpArticles } from "@/lib/help-content";
import type { Profile } from "@/lib/domain";
import Link from "next/link";
import { developer } from "@/lib/developer";

export function HelpCenter({ role }: { role?: Profile["role"] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const path = usePathname();
  const context = helpContext(path);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All topics");
  const articles = visibleHelpArticles(role);
  const categories = [
    "All topics",
    ...new Set(articles.map((a) => a.category)),
  ];
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = articles.filter(
    (a) =>
      (category === "All topics" || a.category === category) &&
      terms.every((term) =>
        [a.title, a.summary, ...a.steps].join(" ").toLowerCase().includes(term),
      ),
  );
  const ordered = [...matches].sort(
    (a, b) => Number(b.id === context.id) - Number(a.id === context.id),
  );
  const close = () => dialog.current?.close();
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="help-trigger"
        aria-label="Open help"
        aria-haspopup="dialog"
        aria-controls={id}
        title="Help and guidance"
        onClick={() => {
          dialog.current?.showModal();
          search.current?.focus();
        }}
      >
        <CircleHelp size={19} aria-hidden="true" />
        <span>Help</span>
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="help-dialog"
        aria-labelledby={id + "-title"}
        aria-describedby={id + "-description"}
        aria-modal="true"

        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}

        onClose={() => {
          setQuery("");
          setCategory("All topics");
          trigger.current?.focus();
        }}
      >
        <div className="help-header">
          <div className="help-heading">
            <span className="help-heading-icon">
              <LifeBuoy size={24} aria-hidden="true" />
            </span>
            <div>
              <span className="eyebrow">CAEDM SOFTWARE HUB</span>
              <h2 id={id + "-title"}>How can we help?</h2>
            </div>
          </div>
          <button
            type="button"
            className="help-close"
            aria-label="Close help"
            onClick={close}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="help-search-area">
          <p id={id + "-description"}>
            Guidance for {context.page}, with step-by-step answers for your
            workspace.
          </p>
          <label className="help-search">
            <span className="sr-only">Search help</span>
            <Search size={19} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invitations, passwords, renewals..."
              maxLength={200}
            />
          </label>
          <div
            className="help-categories"
            role="group"
            aria-label="Help topics"
          >
            {categories.map((c) => (
              <button
                type="button"
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="help-articles">
          <p className="help-result-count" role="status">
            {matches.length} {matches.length === 1 ? "answer" : "answers"}
            {query.trim() ? " matching your search" : " available"}
          </p>
          {ordered.length ? (
            ordered.map((a) => (
              <details
                key={path + ":" + a.id}
                className="help-article"
                open={!!query.trim() || a.id === context.id}
              >
                <summary>
                  <span>
                    <small>
                      {a.category}
                      {a.id === context.id ? " / On this page" : ""}
                    </small>
                    <strong>{a.title}</strong>
                  </span>
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <div className="help-answer">
                  <p>{a.summary}</p>
                  <ol>
                    {a.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              </details>
            ))
          ) : (
            <div className="help-no-results">
              <CircleHelp size={28} aria-hidden="true" />
              <h3>No matching guidance</h3>
              <p>
                Try a different word or choose another topic. Your workspace
                administrator can help with account-specific questions.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("All topics");
                  search.current?.focus();
                }}
              >
                Clear search and topics
              </button>
            </div>
          )}
        </div>
        <div className="help-footer">
          <div className="help-developer">
            <span className="eyebrow">Developer information</span>
            <p>
              <strong>{developer.name}</strong> / {developer.title}
            </p>
            <a href={`mailto:${developer.email}`}>{developer.email}</a>
            <p>
              Need a hand? Contact Ruban with the page and error message. Keep
              passwords and invitation links private.
            </p>
            <Link
              href="/request-feature"
              onClick={close}
              className="help-feature-link"
            >
              Request a Feature
            </Link>
            {!role && (
              <small>
                Feature requests require a verified work account. Accounts
                awaiting approval can also submit.
              </small>
            )}
          </div>
          <button type="button" onClick={close}>
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}

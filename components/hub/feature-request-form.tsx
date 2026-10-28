"use client";
import { useActionState, useState } from "react";
import { CheckCircle2, Send, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  submitFeatureRequest,
  retryFeatureRequest,
  type FeatureRequestState,
} from "@/app/request-feature/actions";
import { featureAreas, featurePriorities } from "@/lib/feature-request-content";
import { developer } from "@/lib/developer";

export function FeatureRequestForm({
  requestKey,
  name,
  email,
}: {
  requestKey: string;
  name: string;
  email: string;
}) {
  const [key, setKey] = useState(requestKey);
  return (
    <RequestForm
      key={key}
      requestKey={key}
      name={name}
      email={email}
      startAnother={() => setKey(crypto.randomUUID())}
    />
  );
}
function RequestForm({
  requestKey,
  name,
  email,
  startAnother,
}: {
  requestKey: string;
  name: string;
  email: string;
  startAnother: () => void;
}) {
  const [state, action, pending] = useActionState<
    FeatureRequestState,
    FormData
  >(submitFeatureRequest, {});
  const [values, setValues] = useState({
    title: "",
    area: "General",
    priority: "Normal",
    department: "",
    problem: "",
    solution: "",
    benefit: "",
    workaround: "",
  });
  const change = (field: keyof typeof values, value: string) =>
    setValues((old) => ({ ...old, [field]: value }));
  if (state.receipt)
    return (
      <div className="feature-receipt">
        <CheckCircle2 size={32} aria-hidden="true" />
        <h2>Thank you for your idea</h2>
        <p className="notice" role="status">
          {state.success}
        </p>
        {state.error && (
          <p className="notice error" role="alert">
            {state.error}
          </p>
        )}
        <dl>
          <div>
            <dt>Request</dt>
            <dd>{state.receipt.title}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd className="feature-reference">{state.receipt.id}</dd>
          </div>
          <div>
            <dt>Developer</dt>
            <dd>
              <a href={`mailto:${developer.email}`}>
                {developer.name} / {developer.email}
              </a>
            </dd>
          </div>
        </dl>
        <p className="field-hint">
          Keep the reference for follow-up. Review does not guarantee an
          implementation date. You can check email delivery and retry from Your
          recent requests below.
        </p>
        <Button type="button" variant="outline" onClick={startAnother}>
          Submit another request
        </Button>
      </div>
    );
  return (
    <form action={action} className="feature-form" aria-label="Feature request">
      <input type="hidden" name="request_key" value={requestKey} />
      <div className="feature-identity">
        <strong>Submitting as {name}</strong>
        <span>{email}</span>
        <small>
          Your verified account identifies you automatically. Replies will go to
          this email.
        </small>
      </div>
      <fieldset disabled={pending} className="space-y-5">
        <label>
          Request title
          <input
            name="title"
            value={values.title}
            onChange={(e) => change("title", e.target.value)}
            required
            minLength={8}
            maxLength={120}
            placeholder="A short, specific title for your idea"
          />
        </label>
        <div className="form-grid">
          <label>
            Area of the application
            <select
              name="area"
              value={values.area}
              onChange={(e) => change("area", e.target.value)}
            >
              {featureAreas.map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              name="priority"
              value={values.priority}
              onChange={(e) => change("priority", e.target.value)}
            >
              {featurePriorities.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Department (optional)
          <input
            name="department"
            value={values.department}
            onChange={(e) => change("department", e.target.value)}
            maxLength={120}
            placeholder="Your team or department"
          />
        </label>
        <label>
          Problem or need
          <textarea
            name="problem"
            value={values.problem}
            onChange={(e) => change("problem", e.target.value)}
            required
            minLength={20}
            maxLength={3000}
            rows={4}
            placeholder="What is difficult today, and who is affected?"
          />
        </label>
        <label>
          Proposed improvement
          <textarea
            name="solution"
            value={values.solution}
            onChange={(e) => change("solution", e.target.value)}
            required
            minLength={20}
            maxLength={4000}
            rows={4}
            placeholder="Describe the behavior or feature you would like to see."
          />
        </label>
        <label>
          Expected benefit
          <textarea
            name="benefit"
            value={values.benefit}
            onChange={(e) => change("benefit", e.target.value)}
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="How would this help you or your team?"
          />
        </label>
        <label>
          Current workaround (optional)
          <textarea
            name="workaround"
            value={values.workaround}
            onChange={(e) => change("workaround", e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="How do you handle this today?"
          />
        </label>
      </fieldset>
      <p className="field-hint">
        Please leave out passwords, invitation links and confidential financial
        information. Priority describes the impact on your work; it does not set
        a delivery deadline.
      </p>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <div className="feature-submit">
        <Button disabled={pending}>
          <Send size={16} aria-hidden="true" />
          {pending ? "Saving request..." : "Submit feature request"}
        </Button>
        <span>Email destination: {developer.email}</span>
      </div>
    </form>
  );
}
export function RetryFeatureRequest({ id }: { id: string }) {
  const [state, action, pending] = useActionState<
    FeatureRequestState,
    FormData
  >(retryFeatureRequest, {});
  return (
    <form action={action} className="feature-retry">
      <input type="hidden" name="request_id" value={id} />
      <Button variant="outline" disabled={pending}>
        <RotateCcw size={14} aria-hidden="true" />
        {pending ? "Retrying..." : "Retry email delivery"}
      </Button>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}

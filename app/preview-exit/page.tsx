import { session } from "@/lib/auth";
import { endPreview } from "@/app/developer-actions";
import { Brand } from "@/components/hub/brand";
export default async function PreviewExitPage() {
  await session();
  return (
    <main className="auth-page">
      <Brand />
      <section className="card">
        <h1>Your preview needs to end</h1>
        <p>
          Your role or Developer authorization changed. Protected operations are
          blocked. Return to your actual view to continue.
        </p>
        <form action={endPreview}>
          <button className="button-primary">Return to My View</button>
        </form>
      </section>
    </main>
  );
}

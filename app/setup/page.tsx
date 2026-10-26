import Link from "next/link";
export default function Setup() {
  return (
    <main className="standalone">
      <section className="panel max-w-xl p-10">
        <span className="eyebrow">CAEDM SOFTWARE HUB</span>
        <h1>Connect your workspace</h1>
        <p className="text-muted-foreground my-4">
          Configuration or database setup needs attention. No business data is
          accessible until setup is complete.
        </p>
        <ol className="list-decimal pl-5 space-y-3">
          <li>
            Copy .env.example to .env.local and set your Supabase URL and
            publishable key.
          </li>
          <li>Apply the versioned migrations in supabase/migrations.</li>
          <li>Enable email confirmation and the Before User Created hook.</li>
          <li>
            Verify a designated administrator account, then run the bootstrap
            SQL.
          </li>
        </ol>
        <p className="mt-6 text-sm">
          Detailed instructions are in the repository README.md.
        </p>
        <Link className="text-primary inline-block mt-6" href="/login">
          Return to sign in →
        </Link>
      </section>
    </main>
  );
}

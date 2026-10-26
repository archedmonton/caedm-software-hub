import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <section className="panel p-10">
        <h1>Page not found</h1>
        <p className="my-5">This record may be unavailable to your account.</p>
        <Link className="text-primary" href="/dashboard">
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}

import Link from "next/link";
import { logout } from "@/app/auth/actions";
export default function Page() {
  return (
    <main className="developer-page assisted-recovery-page">
      <section className="card">
        <h1>Password reset required</h1>
        <p>
          An administrator started account recovery, or this session predates
          your password reset. Complete the private recovery link or use Forgot
          password. After changing your password, sign in again.
        </p>
        <Link className="button" href="/forgot-password">
          Forgot password
        </Link>
        <form action={logout} className="mt-6">
          <button className="button" type="submit">
            Sign out and return to sign in
          </button>
        </form>
      </section>
    </main>
  );
}

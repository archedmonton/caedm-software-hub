import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { session } from "@/lib/auth";
import { logout } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
export default async function Pending() {
  const { profile, user } = await session();
  return (
    <main className="standalone">
      <div className="panel max-w-lg p-10">
        <ShieldCheck className="text-primary mb-5" size={32} />
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>
          {profile.status === "active" && user.email_confirmed_at
            ? "Your account is ready"
            : profile.status === "pending_approval"
              ? "Your request is with IT"
              : "Account access is restricted"}
        </h1>
        <p className="text-muted-foreground my-5">
          {!user.email_confirmed_at
            ? "Verify your work email first. An administrator must then approve your account."
            : profile.status === "pending_approval"
              ? "Your email is verified. An administrator will assign your role and department before you can access the workspace."
              : "Contact your administrator if you need help with your account."}
        </p>
        <p className="mb-6 text-sm">
          {profile.email} · {profile.status.replaceAll("_", " ")}
        </p>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/dashboard">Check access</Link>
          </Button>
          <form action={logout}>
            <Button>Sign out</Button>
          </form>
        </div>
      </div>
    </main>
  );
}

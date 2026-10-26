import { AuthForm } from "@/components/hub/auth-form";
import { configured } from "@/lib/env";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  return (
    <AuthForm
      mode="login"
      ready={configured()}
      notice={
        query.error
          ? "This verification or reset link is invalid or expired. Request a new link or sign in."
          : undefined
      }
    />
  );
}
